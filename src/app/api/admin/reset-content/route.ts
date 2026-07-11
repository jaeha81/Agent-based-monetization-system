import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { deleteYouTubeVideo } from '@/lib/youtube'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/admin/reset-content
// body: { contentId: number, deleteVideoId?: string }
//
// posted 처리된 콘텐츠를 재업로드 가능한 draft 상태로 되돌린다.
//  - deleteVideoId 가 있으면 기존 OAuth 토큰으로 YouTube 영상도 삭제 시도.
//  - content / scheduled_posts 데이터만 UPDATE (스키마 변경 없음).
export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let contentId: number
  let deleteVideoId: string | undefined
  try {
    const body = await req.json() as { contentId: number; deleteVideoId?: string }
    contentId = Number(body.contentId)
    deleteVideoId = body.deleteVideoId
    if (!contentId) throw new Error('contentId 없음')
  } catch {
    return NextResponse.json({ error: 'contentId 필요' }, { status: 400 })
  }

  const before = {
    content: await queryOne(
      `SELECT id, status, posted_at, video_url, render_status, render_id FROM content WHERE id = ?`,
      [contentId]
    ),
    scheduled_posts: await query(
      `SELECT id, status, youtube_video_id, published_at FROM scheduled_posts WHERE content_id = ?`,
      [contentId]
    ),
  }

  if (!before.content) {
    return NextResponse.json({ error: `content_id ${contentId} 없음` }, { status: 404 })
  }

  // 1) YouTube 영상 삭제 (옵션)
  let youtubeDelete: { attempted: boolean; ok: boolean; videoId?: string; error?: string } = { attempted: false, ok: false }
  if (deleteVideoId) {
    try {
      await deleteYouTubeVideo(deleteVideoId)
      youtubeDelete = { attempted: true, ok: true, videoId: deleteVideoId }
    } catch (err) {
      youtubeDelete = {
        attempted: true,
        ok: false,
        videoId: deleteVideoId,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // 2) content draft 리셋
  const c = await execute(
    `UPDATE content
     SET status = 'draft', posted_at = NULL, video_url = NULL,
         render_status = 'idle', render_id = NULL
     WHERE id = ?`,
    [contentId]
  )
  // 3) scheduled_posts 리셋
  const sp = await execute(
    `UPDATE scheduled_posts
     SET status = 'pending', youtube_video_id = NULL, published_at = NULL
     WHERE content_id = ?`,
    [contentId]
  )

  const after = {
    content: await queryOne(
      `SELECT id, status, posted_at, video_url, render_status, render_id FROM content WHERE id = ?`,
      [contentId]
    ),
    scheduled_posts: await query(
      `SELECT id, status, youtube_video_id, published_at FROM scheduled_posts WHERE content_id = ?`,
      [contentId]
    ),
  }

  return NextResponse.json({
    ok: true,
    contentId,
    youtubeDelete,
    rowsAffected: { content: c.rowsAffected, scheduled_posts: sp.rowsAffected },
    before,
    after,
  })
}
