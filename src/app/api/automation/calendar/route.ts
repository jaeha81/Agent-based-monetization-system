import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()))
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1))

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-01`

  const rows = await query<{
    id: number
    platform: string
    product_name: string
    status: string
    scheduled_for: string
    published_at: string | null
  }>(
    `SELECT sp.id, sp.platform, p.name as product_name, sp.status, sp.scheduled_for, sp.published_at
     FROM scheduled_posts sp
     JOIN content c ON sp.content_id = c.id
     JOIN products p ON c.product_id = p.id
     WHERE sp.scheduled_for >= ? AND sp.scheduled_for < ?
     ORDER BY sp.scheduled_for ASC`,
    [startDate, endDate]
  )

  const events: Record<number, Array<{ platform: string; product_name: string; status: string; time: string }>> = {}

  for (const row of rows) {
    const d = new Date(row.scheduled_for)
    const day = d.getDate()
    const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    if (!events[day]) events[day] = []
    events[day].push({ platform: row.platform, product_name: row.product_name, status: row.status, time })
  }

  return NextResponse.json({ events, total: rows.length })
}
