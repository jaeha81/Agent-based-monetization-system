import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const limit = Number(searchParams.get('limit') || 20)

  let sql = `SELECT id, name, category, coupang_url, commission_rate, viral_score,
                    estimated_revenue, performance_score, total_views, total_clicks,
                    total_engaged_views,
                    avg_retention, last_performance_sync_at, created_at
                    , actual_revenue, total_cost, net_profit, profit_score, selection_score,
                    decision_confidence, decision_action, decision_reason, decision_updated_at
                    , market_trend_score, market_trend_reason, market_trend_updated_at,
                    revenue_data_complete_through
             FROM products`
  const params: (null | string | number)[] = []

  if (category && category !== '전체') {
    sql += ' WHERE category = ?'
    params.push(category)
  }
  sql += " ORDER BY CASE COALESCE(decision_action, 'learn') WHEN 'scale' THEN 0 WHEN 'learn' THEN 1 WHEN 'hold' THEN 2 ELSE 3 END, selection_score DESC, created_at DESC LIMIT ?"
  params.push(limit)

  const products = await query<Record<string, unknown>>(sql, params)
  return NextResponse.json(products)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const result = await execute(
    'INSERT INTO products (name, category, coupang_url, commission_rate, viral_score, estimated_revenue) VALUES (?, ?, ?, ?, ?, ?)',
    [
      body.name, body.category,
      body.coupang_url || null,
      body.commission_rate || 3.0,
      body.viral_score || 70,
      body.estimated_revenue || 1000000,
    ]
  )
  return NextResponse.json({ id: result.lastInsertRowid })
}
