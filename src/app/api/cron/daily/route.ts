import { NextRequest, NextResponse } from 'next/server'
import { startWorkflow } from '@/lib/workflow-engine'
import { runBrainScan } from '@/lib/agent-brain'

export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron/Daily] 워크플로우 엔진 사이클 시작')
  const started = Date.now()

  try {
    // 1. 파이프라인 실행
    const result = await startWorkflow('daily_pipeline', 'cron')

    // 2. 브레인 스캔 (비동기 — 파이프라인 실패 여부와 무관하게 실행)
    runBrainScan().catch(e => console.error('[Cron/Daily] BrainScan error:', e))

    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`[Cron/Daily] 완료 — ${elapsed}s rootJob=${result.rootJobId}`)
    return NextResponse.json({ ok: true, elapsed: `${elapsed}s`, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Cron/Daily] 오류:', msg)
    // 파이프라인 실패 시에도 브레인 스캔은 실행
    runBrainScan().catch(() => {})
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
