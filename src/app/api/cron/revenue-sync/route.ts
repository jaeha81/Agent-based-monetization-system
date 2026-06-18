import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { getVideoStats } from '@/lib/youtube'

export const runtime = 'nodejs'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_REFRESH_TOKEN) {
    return NextResponse.json({ ok: true, message: 'YouTube 자격증명 미설정', updated: 0 })
  }

  // YouTube에 실제 업로드된 콘텐츠의 조회수 가져오기
  const postedYoutube = await query<{
    id: number; youtube_video_id: string | null; content_id: number
  }>(
    `SELECT sp.id, sp.youtube_video_id, sp.content_id
     FROM scheduled_posts sp
     WHERE sp.platform = 'YouTube'
       AND sp.status = 'published'
       AND sp.youtube_video_id IS NOT NULL
     ORDER BY sp.published_at DESC
     LIMIT 20`
  )

  let updated = 0
  for (const post of postedYoutube) {
    if (!post.youtube_video_id) continue
    try {
      const stats = await getVideoStats(post.youtube_video_id)
      if (stats.viewCount > 0) {
        await execute(
          `UPDATE content SET views = ? WHERE id = ?`,
          [stats.viewCount, post.content_id]
        )
        updated++
      }
    } catch (e) {
      console.error(`[revenue-sync] 조회수 조회 실패 (${post.youtube_video_id}):`, e)
    }
  }

  return NextResponse.json({
    ok: true,
    message: `YouTube 실제 조회수 ${updated}개 업데이트 완료. 쿠팡 수수료는 partners.coupang.com에서 확인하세요.`,
    updated,
  })
}
