import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const platform = searchParams.get('platform')

  let sql = 'SELECT id, platform, username, followers, total_revenue, post_count, status FROM accounts'
  const params: (null | string | number)[] = []

  if (platform) {
    sql += ' WHERE platform = ?'
    params.push(platform)
  }
  sql += ' ORDER BY total_revenue DESC'

  const accounts = await query<Record<string, unknown>>(sql, params)
  return NextResponse.json(accounts)
}
