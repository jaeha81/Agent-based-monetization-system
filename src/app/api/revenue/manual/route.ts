import { NextRequest, NextResponse } from 'next/server'
import { execute, query, queryOne } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import {
  prepareRevenueEvent,
  refreshRevenueDerivedData,
  RevenueEventValidationError,
  upsertRevenueEvent,
  type RevenueEventInput,
} from '@/lib/revenue-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const [entries, totalRow, pendingRow, platformRows] = await Promise.all([
      query<{
        id: number
        platform: string
        source: string
        amount: number
        period: string
        note: string | null
        product_id: number | null
        content_id: number | null
        external_id: string | null
        event_type: 'commission' | 'refund' | 'adjustment'
        currency: string
        occurred_at: string | null
        settlement_status: 'pending' | 'settled'
        created_at: string
      }>(`SELECT id, platform, source, amount, period, note, product_id, content_id,
                 external_id, event_type, currency, occurred_at, settlement_status, created_at
          FROM manual_revenue_entries ORDER BY COALESCE(occurred_at, created_at) DESC LIMIT 200`),
      queryOne<{ total: number }>(`
        SELECT COALESCE(SUM(amount), 0) total FROM manual_revenue_entries
        WHERE COALESCE(settlement_status, 'settled') = 'settled'
      `),
      queryOne<{ total: number }>(`
        SELECT COALESCE(SUM(amount), 0) total FROM manual_revenue_entries
        WHERE settlement_status = 'pending'
      `),
      query<{ platform: string; total: number }>(`
        SELECT platform, SUM(amount) total FROM manual_revenue_entries
        WHERE COALESCE(settlement_status, 'settled') = 'settled'
        GROUP BY platform
      `),
    ])
    return NextResponse.json({
      entries,
      total: Number(totalRow?.total || 0),
      pendingTotal: Number(pendingRow?.total || 0),
      byPlatform: Object.fromEntries(platformRows.map(row => [row.platform, Number(row.total || 0)])),
    })
  } catch (error) {
    console.error('[revenue/manual] 조회 실패:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: '정산 데이터 조회에 실패했습니다.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json() as RevenueEventInput
    const event = await prepareRevenueEvent(body)
    const result = await upsertRevenueEvent(event)
    await refreshRevenueDerivedData()
    return NextResponse.json({ ok: true, id: result.id, idempotentUpdate: result.updated })
  } catch (error) {
    if (error instanceof RevenueEventValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[revenue/manual] 저장 실패:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: '정산 데이터 저장에 실패했습니다.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id || !/^\d+$/.test(id)) return NextResponse.json({ error: '유효한 id가 필요합니다.' }, { status: 400 })
  try {
    const result = await execute('DELETE FROM manual_revenue_entries WHERE id = ?', [Number(id)])
    if (!result.rowsAffected) return NextResponse.json({ error: '정산 항목을 찾을 수 없습니다.' }, { status: 404 })
    await refreshRevenueDerivedData()
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[revenue/manual] 삭제 실패:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: '정산 데이터 삭제에 실패했습니다.' }, { status: 500 })
  }
}
