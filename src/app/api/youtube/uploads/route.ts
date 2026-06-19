import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getVideosStats } from '@/lib/youtube'

export interface UploadRow {
  sp_id: number
  youtube_video_id: string
  sp_status: string
  published_at: string | null
  sp_created_at: string
  sp_error: string | null
  content_id: number
  platform: string
  hook: string | null
  product_name: string | null
  category: string | null
  coupang_url: string | null
}

export async function GET() {
  try {
    const uploads = await query<UploadRow>(`
      SELECT
        sp.id          AS sp_id,
        sp.youtube_video_id,
        sp.status      AS sp_status,
        sp.published_at,
        sp.created_at  AS sp_created_at,
        sp.error       AS sp_error,
        c.id           AS content_id,
        c.platform,
        c.hook,
        p.name         AS product_name,
        p.category,
        p.coupang_url
      FROM scheduled_posts sp
      LEFT JOIN content c ON c.id = sp.content_id
      LEFT JOIN products p ON p.id = c.product_id
      WHERE sp.youtube_video_id IS NOT NULL
      ORDER BY sp.created_at DESC
      LIMIT 30
    `)

    const videoIds = uploads.map(u => u.youtube_video_id).filter(Boolean)
    const ytStats = await getVideosStats(videoIds)

    const result = uploads.map(u => ({
      ...u,
      youtube_url: `https://youtube.com/shorts/${u.youtube_video_id}`,
      studio_url: `https://studio.youtube.com/video/${u.youtube_video_id}/edit`,
      yt: ytStats[u.youtube_video_id] ?? null,
    }))

    return NextResponse.json({ uploads: result, total: result.length })
  } catch (e) {
    return NextResponse.json({ error: String(e), uploads: [] }, { status: 500 })
  }
}
