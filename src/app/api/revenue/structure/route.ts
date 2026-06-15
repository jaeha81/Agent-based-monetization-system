import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const byProduct = await query<{
      name: string; category: string; commission_rate: number
      total_revenue: number; total_views: number; content_count: number; rpm: number
    }>(`
      SELECT p.name, p.category, p.commission_rate,
             SUM(c.revenue) as total_revenue,
             SUM(c.views) as total_views,
             COUNT(c.id) as content_count,
             ROUND(CAST(SUM(c.revenue) AS REAL) / NULLIF(SUM(c.views), 0) * 1000, 2) as rpm
      FROM content c
      JOIN products p ON c.product_id = p.id
      WHERE c.status = 'posted'
      GROUP BY p.id
      ORDER BY total_revenue DESC
      LIMIT 10
    `)

    const byPlatform = await query<{
      platform: string; total_revenue: number; total_views: number
      content_count: number; avg_revenue_per_post: number
    }>(`
      SELECT c.platform,
             SUM(c.revenue) as total_revenue,
             SUM(c.views) as total_views,
             COUNT(c.id) as content_count,
             AVG(c.revenue) as avg_revenue_per_post
      FROM content c
      WHERE c.status = 'posted'
      GROUP BY c.platform
      ORDER BY total_revenue DESC
    `)

    const byCategory = await query<{
      category: string; total_revenue: number; total_views: number
      product_count: number; avg_commission: number
    }>(`
      SELECT p.category,
             SUM(c.revenue) as total_revenue,
             SUM(c.views) as total_views,
             COUNT(DISTINCT p.id) as product_count,
             AVG(p.commission_rate) as avg_commission
      FROM content c
      JOIN products p ON c.product_id = p.id
      WHERE c.status = 'posted'
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
        SUM(c.revenue) as total_revenue
      FROM products p
      LEFT JOIN content c ON c.product_id = p.id
    `)

    const weeklyTrend = await query<{ date: string; revenue: number; commission_type: string }>(`
      SELECT DATE(logged_at) as date,
             SUM(amount) as revenue,
             commission_type
      FROM revenue_logs
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
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
