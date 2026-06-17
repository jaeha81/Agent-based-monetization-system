import { NextRequest, NextResponse } from 'next/server'
import { resumeVideoRenderJob } from '@/lib/workflow-engine'

export const runtime = 'nodejs'
export const maxDuration = 300

// Shotstack가 렌더링 완료 시 POST로 호출
// Body: { type, status, id (renderId), url, ... }
export async function POST(req: NextRequest) {
  // 시크릿 검증
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const renderId = body.id as string | undefined
  const status = body.status as string | undefined
  const videoUrl = body.url as string | undefined

  console.log(`[Webhook/Shotstack] render_id=${renderId} status=${status} url=${videoUrl}`)

  if (!renderId) {
    return NextResponse.json({ error: 'render_id missing' }, { status: 400 })
  }

  if (status === 'done' && videoUrl) {
    try {
      await resumeVideoRenderJob(renderId, videoUrl)
      return NextResponse.json({ ok: true, renderId, action: 'youtube_upload_queued' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Webhook/Shotstack] resumeVideoRenderJob 실패:', msg)
      return NextResponse.json({ ok: false, error: msg }, { status: 500 })
    }
  }

  if (status === 'failed') {
    // 실패 시 workflow_jobs에 에러 기록
    const { execute } = await import('@/lib/db')
    await execute(
      `UPDATE workflow_jobs SET status = 'failed', error = ?, completed_at = datetime('now')
       WHERE render_id = ? AND status = 'waiting'`,
      [`Shotstack 렌더 실패: ${body.error || 'unknown'}`, renderId]
    )
    return NextResponse.json({ ok: false, renderId, status: 'render_failed' })
  }

  // 진행 중 알림 (queued, fetching 등) — 무시
  return NextResponse.json({ ok: true, renderId, status, action: 'ignored' })
}
