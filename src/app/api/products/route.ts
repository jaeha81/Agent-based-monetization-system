import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const db = getDb()
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const limit = Number(searchParams.get('limit') || 20)

  let query = 'SELECT * FROM products'
  const params: unknown[] = []

  if (category && category !== '전체') {
    query += ' WHERE category = ?'
    params.push(category)
  }
  query += ' ORDER BY viral_score DESC LIMIT ?'
  params.push(limit)

  const products = db.prepare(query).all(...params)
  return NextResponse.json(products)
}

export async function POST(req: NextRequest) {
  const db = getDb()
  const body = await req.json()
  const result = db.prepare(
    'INSERT INTO products (name, category, coupang_url, commission_rate, viral_score, estimated_revenue) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    body.name, body.category,
    body.coupang_url || null,
    body.commission_rate || 3.0,
    body.viral_score || 70,
    body.estimated_revenue || 1000000
  )
  return NextResponse.json({ id: result.lastInsertRowid })
}
