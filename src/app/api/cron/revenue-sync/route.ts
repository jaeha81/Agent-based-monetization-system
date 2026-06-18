import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'

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

  // YouTube Analytics API 미연동 상태 — 실제 조회수/수익 데이터 없음
  // 실제 쿠팡 파트너스 수수료는 파트너스 대시보드(partners.coupang.com)에서 수동 확인 필요
  // 이 엔드포인트는 향후 YouTube Analytics API 또는 쿠팡 파트너스 API 연동 시 활성화

  const postedCount = await query<{ id: number }>(
    `SELECT c.id FROM content c WHERE c.status = 'posted' LIMIT 1`
  )

  return NextResponse.json({
    ok: true,
    message: '실제 수익 데이터는 쿠팡 파트너스 대시보드(partners.coupang.com)에서 확인하세요.',
    postedContent: postedCount.length,
    revenueAdded: 0,
  })
}
