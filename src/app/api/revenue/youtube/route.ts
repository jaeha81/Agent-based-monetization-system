import { NextRequest, NextResponse } from 'next/server'
import { getYouTubeAnalyticsRevenue } from '@/lib/youtube'
import { query } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get('days') || '30')

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const startStr = startDate.toISOString().slice(0, 10)
  const endStr = endDate.toISOString().slice(0, 10)

  const [analytics, videoStats] = await Promise.all([
    process.env.YOUTUBE_REFRESH_TOKEN
      ? getYouTubeAnalyticsRevenue(startStr, endStr)
      : Promise.resolve({ rows: [], totalRevenue: 0, totalViews: 0, hasMonetization: false }),
    // Real view counts from DB (synced by revenue-sync cron)
    query<{ youtube_video_id: string; views: number; product_name: string; posted_at: string | null }>(`
      SELECT sp.youtube_video_id, c.views, p.name as product_name, sp.published_at as posted_at
      FROM scheduled_posts sp
      JOIN content c ON sp.content_id = c.id
      JOIN products p ON c.product_id = p.id
      WHERE sp.platform = 'YouTube'
        AND sp.status = 'published'
        AND sp.youtube_video_id IS NOT NULL
      ORDER BY sp.published_at DESC
      LIMIT 20
    `),
  ])

  const totalViewsFromDb = videoStats.reduce((s, v) => s + (v.views || 0), 0)

  return NextResponse.json({
    analytics,
    videoStats,
    totalViewsFromDb,
    period: { startDate: startStr, endDate: endStr, days },
    credentialSet: !!process.env.YOUTUBE_REFRESH_TOKEN,
  })
}
