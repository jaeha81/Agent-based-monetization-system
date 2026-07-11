import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const byProduct = await query<{
      name: string; category: string; commission_rate: number
      total_revenue: number; total_views: number; content_count: number; rpm: number
    }>(`
      SELECT p.name, p.category, p.commission_rate,
             p.actual_revenue as total_revenue,
             COALESCE(SUM(CASE WHEN c.metrics_source = 'youtube_api' THEN c.views ELSE 0 END), 0) as total_views,
             COUNT(c.id) as content_count,
             ROUND(CAST(p.actual_revenue AS REAL) / NULLIF(SUM(CASE WHEN c.metrics_source = 'youtube_api' THEN c.views ELSE 0 END), 0) * 1000, 2) as rpm
      FROM products p
      LEFT JOIN content c ON c.product_id = p.id
      GROUP BY p.id
      ORDER BY total_revenue DESC
      LIMIT 10
    `)

    const byPlatform = await query<{
      platform: string; total_revenue: number; total_views: number
      content_count: number; avg_revenue_per_post: number
    }>(`
      SELECT re.platform,
             SUM(re.amount) as total_revenue,
             COALESCE((SELECT SUM(c.views) FROM content c WHERE c.platform = re.platform AND c.metrics_source = 'youtube_api'), 0) as total_views,
             (SELECT COUNT(*) FROM content c WHERE c.platform = re.platform) as content_count,
             SUM(re.amount) * 1.0 / NULLIF((SELECT COUNT(*) FROM content c WHERE c.platform = re.platform), 0) as avg_revenue_per_post
      FROM revenue_events re
      GROUP BY re.platform
      ORDER BY total_revenue DESC
    `)

    const byCategory = await query<{
      category: string; total_revenue: number; total_views: number
      product_count: number; avg_commission: number
    }>(`
      SELECT p.category,
             SUM(p.actual_revenue) as total_revenue,
             COALESCE((SELECT SUM(c.views) FROM content c JOIN products px ON px.id = c.product_id WHERE px.category = p.category AND c.metrics_source = 'youtube_api'), 0) as total_views,
             COUNT(DISTINCT p.id) as product_count,
             AVG(p.commission_rate) as avg_commission
      FROM products p
      GROUP BY p.category
      ORDER BY total_revenue DESC
    `)

    const funnel = await queryOne<{
      products_discovered: number; content_created: number
      content_scheduled: number; content_posted: number
      total_views: number; total_clicks: number; total_revenue: number
    }>(`
      SELECT
        COUNT(DISTINCT p.id) as products_discovered,
        COUNT(c.id) as content_created,
        SUM(CASE WHEN c.status IN ('scheduled','posted') THEN 1 ELSE 0 END) as content_scheduled,
        SUM(CASE WHEN c.status = 'posted' THEN 1 ELSE 0 END) as content_posted,
        SUM(c.views) as total_views,
        (SELECT COUNT(*) FROM click_logs) as total_clicks,
        (SELECT COALESCE(SUM(actual_revenue), 0) FROM products) as total_revenue
      FROM products p
      LEFT JOIN content c ON c.product_id = p.id
    `)

    const weeklyTrend = await query<{ date: string; revenue: number; commission_type: string }>(`
      SELECT DATE(logged_at) as date,
             SUM(amount) as revenue,
             commission_type
      FROM revenue_events
      WHERE logged_at >= datetime('now', '-30 days')
      GROUP BY DATE(logged_at), commission_type
      ORDER BY date
    `)

    const agentContrib = await query<{
      agent_name: string; revenue_contributed: number
      total_runs: number; success_runs: number
    }>(`
      SELECT agent_name, revenue_contributed, total_runs, success_runs
      FROM agent_states
      ORDER BY revenue_contributed DESC
    `)

    const accounts = await query<{
      id: number; account_type: string; account_name: string | null
      bank_name: string | null; account_number_masked: string | null
      is_verified: number; total_received: number; last_settled_at: string | null
    }>(`SELECT id, account_type, account_name, bank_name, account_number_masked, is_verified, total_received, last_settled_at FROM revenue_accounts ORDER BY id`)

    return NextResponse.json({
      ok: true, byProduct, byPlatform, byCategory,
      funnel, weeklyTrend, agentContrib, accounts,
    })
  } catch (err) {
    console.error('[revenue/structure] 조회 실패:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ ok: false, error: '수익 구조 조회에 실패했습니다.' }, { status: 500 })
  }
}
