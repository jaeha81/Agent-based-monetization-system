import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const entries = await query<{
    id: number
    platform: string
    source: string
    amount: number
    period: string
    note: string | null
    created_at: string
  }>(`SELECT * FROM manual_revenue_entries ORDER BY created_at DESC LIMIT 100`)

  const total = entries.reduce((s, e) => s + e.amount, 0)

  const byPlatform: Record<string, number> = {}
  for (const e of entries) {
    byPlatform[e.platform] = (byPlatform[e.platform] || 0) + e.amount
  }

  return NextResponse.json({ entries, total, byPlatform })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    platform: string
    source: string
    amount: number
    period: string
    note?: string
  }

  if (!body.platform || !body.source || !body.amount || !body.period) {
    return NextResponse.json({ error: '필수 항목 누락' }, { status: 400 })
  }

  const result = await execute(
    `INSERT INTO manual_revenue_entries (platform, source, amount, period, note) VALUES (?, ?, ?, ?, ?)`,
    [body.platform, body.source, body.amount, body.period, body.note || null]
  )

  return NextResponse.json({ ok: true, id: result.lastInsertRowid })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  await execute(`DELETE FROM manual_revenue_entries WHERE id = ?`, [parseInt(id)])
  return NextResponse.json({ ok: true })
}
