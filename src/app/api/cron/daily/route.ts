import { NextRequest, NextResponse } from 'next/server'
import { startWorkflow, processPendingJobs, pollWaitingVideoRenders } from '@/lib/workflow-engine'
import { runBrainScan } from '@/lib/agent-brain'
import { syncYouTubeMarketTrends } from '@/lib/market-trends'
import { refreshProductTrendScores } from '@/lib/trend-product-matcher'
import { getActiveMarkets } from '@/lib/markets'

export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron/Daily] 워크플로우 엔진 사이클 시작')
  const started = Date.now()

  try {
    const marketTrends = await Promise.all(getActiveMarkets().map(async market => ({ market, result: await syncYouTubeMarketTrends(market).catch(error => {
      console.error('[Cron/Daily] 시장 트렌드 수집 오류:', error)
      return { videos: 0, keywords: [] }
    }) })))
    const trendMatchedProducts = await refreshProductTrendScores().catch(error => {
      console.error('[Cron/Daily] 상품-시장 트렌드 매칭 오류:', error)
      return 0
    })
    // 0. 이전 run에서 waiting 상태로 남은 렌더 잡 정리 (어제 미완료 건)
    //    YouTube 업로드 자격증명(3키) 완비 시에만 폴링 — 불완전 시 완성 렌더 소비→업로드 실패→유실 방지
    const canUpload = !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN)
    const prevResumed = canUpload ? await pollWaitingVideoRenders(10).catch(() => 0) : 0
    if (prevResumed > 0) console.log(`[Cron/Daily] 이전 waiting 렌더 ${prevResumed}건 업로드 트리거됨`)

    // 1. 파이프라인 실행
    const result = await startWorkflow('daily_pipeline', 'cron')

    // 2. 큐 드레인 — startWorkflow limit=10 으로 남은 queued 잡 처리
    const drained = await processPendingJobs('daily_pipeline', 50).catch(e => {
      console.error('[Cron/Daily] processPendingJobs error:', e)
      return 0
    })
    console.log(`[Cron/Daily] 큐 드레인: ${drained}건 처리`)

    // 3. 브레인 스캔 (비동기 — 파이프라인 실패 여부와 무관하게 실행)
    runBrainScan().catch(e => console.error('[Cron/Daily] BrainScan error:', e))

    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`[Cron/Daily] 완료 — ${elapsed}s rootJob=${result.rootJobId}`)
    return NextResponse.json({ ok: true, elapsed: `${elapsed}s`, drained, prevResumed, marketTrends, trendMatchedProducts, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Cron/Daily] 오류:', msg)
    // 파이프라인 실패 시에도 브레인 스캔은 실행
    runBrainScan().catch(() => {})
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
