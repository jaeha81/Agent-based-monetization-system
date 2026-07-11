import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'
import { PRIVATE_UPLOAD_STATUS } from '@/lib/publishing-safety'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'

// POST /api/admin/fix-upload-record
// Body: { contentId: number, youtubeVideoId: string }
// scheduled_posts 누락 항목 수동 삽입 + content status 보정
export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) {
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
      `UPDATE scheduled_posts SET youtube_video_id = ?, status = ?, visibility = 'private', published_at = NULL WHERE content_id = ? AND platform = 'YouTube'`,
      [youtubeVideoId, PRIVATE_UPLOAD_STATUS, contentId]
    )
  } else {
    await execute(
      `INSERT INTO scheduled_posts (content_id, platform, scheduled_for, status, youtube_video_id, visibility, published_at) VALUES (?, 'YouTube', datetime('now'), ?, ?, 'private', NULL)`,
      [contentId, PRIVATE_UPLOAD_STATUS, youtubeVideoId]
    )
  }

  if (content.status !== PRIVATE_UPLOAD_STATUS) {
    await execute(
      `UPDATE content SET status = ?, posted_at = NULL WHERE id = ?`,
      [PRIVATE_UPLOAD_STATUS, contentId]
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
