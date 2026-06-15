import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDb()

  // 게시된 콘텐츠 수익 누적 시뮬레이션 (실제 쿠팡 API 연동 시 교체)
  const posted = db.prepare(
    `SELECT c.id, c.views, c.revenue, p.commission_rate, a.id as account_id
     FROM content c
     JOIN products p ON c.product_id = p.id
     JOIN accounts a ON a.platform = c.platform
     WHERE c.status = 'posted'
     ORDER BY RANDOM() LIMIT 20`
  ).all() as Array<{
    id: number; views: number; revenue: number
    commission_rate: number; account_id: number
  }>

  let totalAdded = 0

  for (const c of posted) {
    const newViews = Math.floor(Math.random() * 2000)
    const newRevenue = Math.floor(newViews * 0.003 * 25000 * (c.commission_rate / 100))

    if (newRevenue > 0) {
      db.prepare(`UPDATE content SET views = views + ?, revenue = revenue + ? WHERE id = ?`)
        .run(newViews, newRevenue, c.id)

      db.prepare(
        `INSERT INTO revenue_logs (account_id, content_id, amount, commission_type)
         VALUES (?, ?, ?, 'coupang_partners')`
      ).run(c.account_id, c.id, newRevenue)

      totalAdded += newRevenue
    }
  }

  return NextResponse.json({ ok: true, revenueAdded: totalAdded, postsUpdated: posted.length })
}
