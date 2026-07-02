import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'

export const runtime = 'nodejs'

// POST /api/admin/fix-upload-record?secret=<CRON_SECRET>
// Body: { contentId: number, youtubeVideoId: string }
// scheduled_posts 누락 항목 수동 삽입 + content status 보정
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { contentId, youtubeVideoId } = await req.json() as { contentId: number; youtubeVideoId: string }
  if (!contentId || !youtubeVideoId) {
    return NextResponse.json({ error: 'contentId and youtubeVideoId required' }, { status: 400 })
  }

  const content = await queryOne<{ id: number; status: string }>(
    'SELECT id, status FROM content WHERE id = ?',
    [contentId]
  )
  if (!content) return NextResponse.json({ error: `content ${contentId} not found` }, { status: 404 })

  const existing = await queryOne(
    `SELECT id FROM scheduled_posts WHERE content_id = ? AND platform = 'YouTube'`,
    [contentId]
  )

  if (existing) {
    await execute(
      `UPDATE scheduled_posts SET youtube_video_id = ?, status = 'published', published_at = datetime('now') WHERE content_id = ? AND platform = 'YouTube'`,
      [youtubeVideoId, contentId]
    )
  } else {
    await execute(
      `INSERT INTO scheduled_posts (content_id, platform, scheduled_for, status, youtube_video_id, published_at) VALUES (?, 'YouTube', datetime('now'), 'published', ?, datetime('now'))`,
      [contentId, youtubeVideoId]
    )
  }

  if (content.status !== 'posted') {
    await execute(
      `UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`,
      [contentId]
    )
  }

  return NextResponse.json({
    ok: true,
    contentId,
    youtubeVideoId,
    action: existing ? 'updated' : 'inserted',
    prevStatus: content.status,
  })
}
