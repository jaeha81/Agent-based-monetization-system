import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { submitShotstackRender } from '@/lib/shotstack'

export const runtime = 'nodejs'
export const maxDuration = 30

// 로컬 에이전트가 content_generation 완료 후 호출하는 엔드포인트
// Shotstack 렌더를 비동기로 제출하고 즉시 반환.
// Shotstack 완료 시 /api/webhook/shotstack → resumeVideoRenderJob → youtube_upload 자동 처리.
export async function POST(req: NextRequest) {
  const auth = req.headers.get('Authorization') || ''
  const secret = process.env.UPLOAD_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let contentId: number
  try {
    const body = await req.json() as { content_id: number }
    contentId = Number(body.content_id)
    if (!contentId) throw new Error('content_id 없음')
  } catch {
    return NextResponse.json({ error: 'content_id 필요' }, { status: 400 })
  }

  const content = await queryOne<{
    id: number
    hook: string | null
    product_name: string
  }>(
    `SELECT c.id, c.hook, p.name as product_name
     FROM content c JOIN products p ON c.product_id = p.id
     WHERE c.id = ? AND c.platform = 'YouTube'`,
    [contentId]
  )

  if (!content) {
    return NextResponse.json(
      { error: `content_id ${contentId} 없음 (YouTube 플랫폼 확인)` },
      { status: 404 }
    )
  }

  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://shorts-dashboard-one.vercel.app'
    const callbackUrl = `${baseUrl}/api/webhook/shotstack?secret=${process.env.CRON_SECRET || ''}`

    const renderId = await submitShotstackRender(
      content.hook || content.product_name,
      content.product_name,
      'ko',
      callbackUrl
    )
    console.log(`[upload/trigger] Shotstack 렌더 제출: renderId=${renderId} contentId=${contentId}`)

    // workflow_jobs에 waiting 잡 등록 (Shotstack webhook이 resumeVideoRenderJob 호출)
    await execute(
      `INSERT INTO workflow_jobs
         (workflow_name, node_type, trigger_type, status, input_data, content_id, render_id, created_at)
       VALUES ('trigger_upload', 'video_render', 'webhook', 'waiting', ?, ?, ?, datetime('now'))`,
      [JSON.stringify({ contentId, language: 'ko' }), contentId, renderId]
    )
    await execute(
      `UPDATE content SET render_id = ?, render_status = 'rendering' WHERE id = ?`,
      [renderId, contentId]
    )

    return NextResponse.json({
      ok: true,
      status: 'pending',
      render_id: renderId,
      content_id: contentId,
      message: '렌더링 시작됨. Shotstack 완료 시 YouTube 업로드 자동 진행.',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[upload/trigger] 실패:`, msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
