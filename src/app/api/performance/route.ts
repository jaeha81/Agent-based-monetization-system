import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const [videos, trendKeywords, trendVideos, music, products, retentionPoints] = await Promise.all([query<{
    content_id: number; youtube_video_id: string; hook: string | null; product_name: string; music_title: string | null
    status: string; visibility: string | null; views: number; engaged_views: number; likes: number; click_count: number
    avg_view_duration: number; avg_view_percentage: number; performance_score: number
  }>(`
    SELECT c.id AS content_id, sp.youtube_video_id, c.hook, p.name AS product_name, mt.title AS music_title,
           sp.status, sp.visibility, sp.qa_status, sp.qa_score, c.views, c.engaged_views, c.likes, c.click_count,
           c.avg_view_duration, c.avg_view_percentage, c.performance_score
    FROM scheduled_posts sp
    JOIN content c ON c.id = sp.content_id
    JOIN products p ON p.id = c.product_id
    LEFT JOIN music_tracks mt ON mt.id = c.music_track_id
    WHERE sp.platform = 'YouTube' AND sp.youtube_video_id IS NOT NULL
    ORDER BY c.performance_score DESC, c.views DESC
    LIMIT 50
  `), query<{ keyword: string; score: number; total_views: number; collected_at: string }>(`
    SELECT keyword, MAX(score) AS score, MAX(total_views) AS total_views, MAX(collected_at) AS collected_at
    FROM market_trend_keywords WHERE collected_at >= datetime('now', '-3 days')
    GROUP BY keyword ORDER BY score DESC LIMIT 12
  `), query<{ external_id: string; title: string; view_count: number; shopping_relevant: number; view_velocity: number; collected_at: string }>(`
    SELECT external_id, title, view_count, shopping_relevant, view_velocity, collected_at
    FROM market_trend_videos ORDER BY shopping_relevant DESC, view_velocity DESC, view_count DESC LIMIT 8
  `), query<{ id: string; title: string; artist: string; license: string; uses: number; avg_retention: number; avg_click_rate: number; performance_score: number; observed_videos: number; observed_views: number; evidence_confidence: number }>(`
    SELECT id, title, artist, license, uses, avg_retention, avg_click_rate, performance_score,
           observed_videos, observed_views, evidence_confidence
    FROM music_tracks WHERE active = 1 AND commercial_use = 1 ORDER BY performance_score DESC, uses DESC
  `), query<{ id: number; name: string; total_views: number; actual_revenue: number; total_cost: number; net_profit: number; profit_score: number; performance_score: number; selection_score: number; decision_confidence: number; decision_action: string; decision_reason: string | null; market_trend_score: number; market_trend_reason: string | null }>(`
    SELECT id, name, total_views, actual_revenue, total_cost, net_profit, profit_score, performance_score,
           selection_score, decision_confidence, decision_action, decision_reason,
           market_trend_score, market_trend_reason
    FROM products ORDER BY selection_score DESC, profit_score DESC LIMIT 20
  `), query<{ content_id: number; elapsed_ratio: number; audience_watch_ratio: number }>(`
    SELECT rp.content_id, rp.elapsed_ratio, rp.audience_watch_ratio
    FROM youtube_retention_points rp
    WHERE rp.window_start = (SELECT MAX(x.window_start) FROM youtube_retention_points x WHERE x.content_id = rp.content_id)
    ORDER BY rp.content_id, rp.elapsed_ratio
  `)])

  const retentionTargets = [0, 0.12, 0.36, 0.60, 0.80]
  const retentionByContent = new Map<number, number[]>()
  for (const video of videos) {
    const points = retentionPoints.filter(point => point.content_id === video.content_id)
    retentionByContent.set(video.content_id, retentionTargets.map(target => {
      const nearest = points.reduce<typeof points[number] | undefined>((best, point) =>
        !best || Math.abs(point.elapsed_ratio - target) < Math.abs(best.elapsed_ratio - target) ? point : best, undefined)
      return nearest ? Number(nearest.audience_watch_ratio || 0) * 100 : 0
    }))
  }

  const rows = videos.map(video => {
    const views = Number(video.views || 0)
    const likes = Number(video.likes || 0)
    const clicks = Number(video.click_count || 0)
    return {
      ...video,
      views,
      engaged_views: Number(video.engaged_views || 0),
      likes,
      click_count: clicks,
      avg_view_duration: Number(video.avg_view_duration || 0),
      avg_view_percentage: Number(video.avg_view_percentage || 0),
      performance_score: Number(video.performance_score || 0),
      click_rate: views > 0 ? clicks / views * 100 : 0,
      like_rate: views > 0 ? likes / views * 100 : 0,
      sample_status: Number(video.engaged_views || 0) >= 300 ? 'reliable' as const : 'learning' as const,
      retention_stages: retentionByContent.get(video.content_id) || [0, 0, 0, 0, 0],
    }
  })

  const reliable = rows.filter(row => row.sample_status === 'reliable')
  const summary = {
    videos: rows.length,
    reliableVideos: reliable.length,
    totalViews: rows.reduce((sum, row) => sum + Number(row.views || 0), 0),
    totalClicks: rows.reduce((sum, row) => sum + Number(row.click_count || 0), 0),
    avgRetention: reliable.length
      ? reliable.reduce((sum, row) => sum + Number(row.avg_view_percentage || 0), 0) / reliable.length
      : 0,
    avgScore: reliable.length
      ? reliable.reduce((sum, row) => sum + Number(row.performance_score || 0), 0) / reliable.length
      : 0,
    clickSignalReliable: process.env.YOUTUBE_CLICKABLE_COMMERCE_ENABLED === 'true',
  }

  const latestTrendAt = trendKeywords[0]?.collected_at || trendVideos[0]?.collected_at || null
  const staleTrend = !latestTrendAt || Date.now() - new Date(latestTrendAt).getTime() > 48 * 60 * 60 * 1000
  return NextResponse.json({
    summary, videos: rows, trendKeywords, trendVideos, music,
    products: products.map(product => ({ ...product, stopped: product.decision_action === 'stop' })),
    freshness: { latestTrendAt, staleTrend },
  })
}
