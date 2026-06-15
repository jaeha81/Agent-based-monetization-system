import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const limit = Number(searchParams.get('limit') || 20)

  let sql = 'SELECT id, name, category, coupang_url, commission_rate, viral_score, estimated_revenue, created_at FROM products'
  const params: (null | string | number)[] = []

  if (category && category !== '전체') {
    sql += ' WHERE category = ?'
    params.push(category)
  }
  sql += ' ORDER BY viral_score DESC LIMIT ?'
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
