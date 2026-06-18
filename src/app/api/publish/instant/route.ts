import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { renderShortsVideo } from '@/lib/shotstack'
import { uploadYouTubeShorts, buildShortsTags } from '@/lib/youtube'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const { contentId } = await req.json() as { contentId: number }
  if (!contentId) return NextResponse.json({ error: 'contentId required' }, { status: 400 })

  const content = await queryOne<{
    id: number; platform: string; hook: string | null; script: string | null
    product_id: number; product_name: string; video_url: string | null; language: string | null
  }>(
    `SELECT c.id, c.platform, c.hook, c.script, c.video_url, c.language,
            p.id as product_id, p.name as product_name
     FROM content c JOIN products p ON c.product_id = p.id WHERE c.id = ?`,
    [contentId]
  )
  if (!content) return NextResponse.json({ error: '콘텐츠 없음' }, { status: 404 })

  if (content.platform !== 'YouTube') {
    await execute(`UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`, [contentId])
    await execute(
      `INSERT INTO scheduled_posts (content_id, platform, scheduled_for, status, published_at) VALUES (?, ?, datetime('now'), 'published', datetime('now'))`,
      [contentId, content.platform]
    )
    return NextResponse.json({ ok: true, platform: content.platform, message: '게시 완료 (수동)' })
  }

  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'YouTube 자격증명 미설정 (YOUTUBE_CLIENT_ID, YOUTUBE_REFRESH_TOKEN)' }, { status: 422 })
  }

  try {
    let videoUrl = content.video_url

    if (!videoUrl && process.env.SHOTSTACK_API_KEY) {
      videoUrl = await renderShortsVideo(
        content.hook || content.product_name,
        content.product_name,
        content.language || 'ko'
      )
      await execute('UPDATE content SET video_url = ? WHERE id = ?', [videoUrl, contentId])
    }

    if (!videoUrl) return NextResponse.json({ error: '영상 URL 없음 (SHOTSTACK_API_KEY 필요)' }, { status: 422 })

    const tags = buildShortsTags(content.product_name, '')
    const videoBuffer = Buffer.from(await (await fetch(videoUrl)).arrayBuffer())
    const ytResult = await uploadYouTubeShorts(
      {
        title: (content.hook || content.product_name).slice(0, 100),
        description: content.script || '',
        tags,
        privacyStatus: 'private',
      },
      videoBuffer
    )

    await execute(`UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`, [contentId])
    await execute(
      `INSERT INTO scheduled_posts (content_id, platform, scheduled_for, status, youtube_video_id, published_at) VALUES (?, 'YouTube', datetime('now'), 'published', ?, datetime('now'))`,
      [contentId, ytResult.videoId]
    )

    return NextResponse.json({ ok: true, videoId: ytResult.videoId, url: ytResult.url })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
