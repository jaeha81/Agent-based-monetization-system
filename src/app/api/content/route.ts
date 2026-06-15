import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const db = getDb()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const platform = searchParams.get('platform')
  const limit = Number(searchParams.get('limit') || 50)

  let query = `
    SELECT c.*, p.name as product_name, p.category
    FROM content c
    JOIN products p ON c.product_id = p.id
    WHERE 1=1
  `
  const params: unknown[] = []

  if (status) { query += ' AND c.status = ?'; params.push(status) }
  if (platform) { query += ' AND c.platform = ?'; params.push(platform) }
  query += ' ORDER BY c.revenue DESC LIMIT ?'
  params.push(limit)

  const content = db.prepare(query).all(...params)
  return NextResponse.json(content)
}
