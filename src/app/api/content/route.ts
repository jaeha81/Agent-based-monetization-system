import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const platform = searchParams.get('platform')
  const limit = Number(searchParams.get('limit') || 50)

  let sql = `
    SELECT c.*, p.name as product_name, p.category,
           COALESCE((SELECT SUM(re.amount) FROM revenue_events re WHERE re.content_id = c.id), 0) AS revenue_from_events
    FROM content c
    JOIN products p ON c.product_id = p.id
    WHERE 1=1
  `
  const params: (null | string | number)[] = []

  if (status) { sql += ' AND c.status = ?'; params.push(status) }
  if (platform) { sql += ' AND c.platform = ?'; params.push(platform) }
  sql += ' ORDER BY revenue_from_events DESC, c.views DESC, c.created_at DESC LIMIT ?'
  params.push(limit)

  const content = await query<Record<string, unknown>>(sql, params)
  return NextResponse.json(content)
}
