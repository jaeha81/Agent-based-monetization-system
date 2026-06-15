import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const db = getDb()
  const { searchParams } = new URL(req.url)
  const platform = searchParams.get('platform')

  let query = 'SELECT * FROM accounts'
  const params: unknown[] = []

  if (platform) {
    query += ' WHERE platform = ?'
    params.push(platform)
  }
  query += ' ORDER BY total_revenue DESC'

  const accounts = db.prepare(query).all(...params)
  return NextResponse.json(accounts)
}
