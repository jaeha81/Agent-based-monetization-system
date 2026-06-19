import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { uploadYouTubeShorts, buildShortsDescription, buildShortsTags } from '@/lib/youtube'
import { resumeVideoRenderJob } from '@/lib/workflow-engine'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: string; status?: string; url?: string; error?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id: renderId, status, url: videoUrl, error } = body

  if (!renderId) {
    return NextResponse.json({ error: 'missing renderId' }, { status: 400 })
  }

  console.log(`[Webhook/Shotstack] render_id=${renderId} status=${status}`)

  if (status === 'failed') {
    await execute(
      `UPDATE scheduled_posts SET status = 'failed', error = ?
       WHERE content_id IN (SELECT id FROM content WHERE render_id = ?)`,
      [error || 'Shotstack render failed', renderId]
    )
    await execute(`UPDATE content SET render_id = NULL WHERE render_id = ?`, [renderId])
    return NextResponse.json({ ok: true, action: 'marked_failed' })
  }

  if (status !== 'done' || !videoUrl) {
    return NextResponse.json({ ok: true, action: 'ignored', status })
  }

  // Path 1: workflow-engine (job waiting for this render_id)
  try {
    await resumeVideoRenderJob(renderId, videoUrl)
  } catch (e) {
    console.error('[Webhook/Shotstack] resumeVideoRenderJob error:', e)
  }

  // Path 2: automation-engine (scheduled_post waiting for video via render_id)
  const content = await queryOne<{
    id: number; hook: string | null; script: string | null
    product_name: string; category: string; coupang_url: string | null
  }>(
    `SELECT c.id, c.hook, c.script, p.name as product_name, p.category, p.coupang_url
     FROM content c
     JOIN products p ON c.product_id = p.id
     WHERE c.render_id = ? AND c.platform = 'YouTube'`,
    [renderId]
  )

  if (content) {
    await execute('UPDATE content SET video_url = ?, render_id = NULL WHERE id = ?', [videoUrl, content.id])

    if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN) {
      try {
        const tags = buildShortsTags(content.product_name, content.category)
        const affiliateUrl = content.coupang_url || 'https://www.coupang.com'
        const description = buildShortsDescription(content.script || '', affiliateUrl, tags)
        const videoBuffer = Buffer.from(await (await fetch(videoUrl)).arrayBuffer())

        const ytResult = await uploadYouTubeShorts({
          title: (content.hook || content.product_name).slice(0, 100),
          description,
          tags,
          privacyStatus: 'private',
          madeForKids: false,
        }, videoBuffer)

        await execute(
          `UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`,
          [content.id]
        )
        await execute(
          `UPDATE scheduled_posts SET youtube_video_id = ?, status = 'published', published_at = datetime('now')
           WHERE content_id = ? AND platform = 'YouTube'`,
          [ytResult.videoId, content.id]
        )

        console.log(`[Webhook/Shotstack] YouTube 업로드 완료: ${ytResult.url}`)
        return NextResponse.json({ ok: true, action: 'youtube_uploaded', videoId: ytResult.videoId, url: ytResult.url })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[Webhook/Shotstack] YouTube upload error:', msg)
        await execute(
          `UPDATE scheduled_posts SET status = 'failed', error = ?
           WHERE content_id = ? AND platform = 'YouTube'`,
          [msg, content.id]
        )
        return NextResponse.json({ ok: false, action: 'youtube_upload_failed', error: msg }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ ok: true, action: 'video_stored', videoUrl })
}
