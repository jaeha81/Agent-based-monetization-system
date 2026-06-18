import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'

export const runtime = 'nodejs'

// 오케스트레이터가 생성한 가짜 수익/조회수 데이터를 1회 초기화
// Authorization: Bearer <CRON_SECRET> 필요
export async function POST(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 1. revenue_logs에서 오케스트레이터가 생성한 가짜 수익 삭제
  //    (content_id가 있는 coupang_partners 항목 = orchestrator 생성분)
  const delLogs = await execute(
    `DELETE FROM revenue_logs WHERE commission_type = 'coupang_partners' AND content_id IS NOT NULL`
  )

  // 2. content 테이블의 views, revenue 초기화
  //    (YouTube revenue-sync cron이 진짜 YouTube 조회수를 다시 채워줌)
  const resetContent = await execute(
    `UPDATE content SET views = 0, revenue = 0`
  )

  // 3. products 테이블의 가짜 viral_score, estimated_revenue 초기화
  const resetProducts = await execute(
    `UPDATE products SET viral_score = 0, estimated_revenue = 0`
  )

  // 4. accounts의 가짜 total_revenue 초기화
  const resetAccounts = await execute(
    `UPDATE accounts SET total_revenue = 0`
  )

  // 5. 초기화 완료 기록 (settings 테이블)
  await execute(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('fake_data_cleaned_at', datetime('now'))`
  )

  const check = await queryOne<{ t: number }>(
    `SELECT COALESCE(SUM(amount), 0) as t FROM revenue_logs`
  )

  return NextResponse.json({
    ok: true,
    deleted: {
      revenue_logs: delLogs.rowsAffected,
      content_rows_reset: resetContent.rowsAffected,
      products_reset: resetProducts.rowsAffected,
      accounts_reset: resetAccounts.rowsAffected,
    },
    remaining_revenue_logs: check?.t ?? 0,
    message: '가짜 데이터 초기화 완료. 실제 YouTube 조회수는 revenue-sync cron 실행 후 복원됩니다.',
  })
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const cleaned = await queryOne<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'fake_data_cleaned_at'`
  )
  const revTotal = await queryOne<{ t: number }>(
    `SELECT COALESCE(SUM(amount), 0) as t FROM revenue_logs`
  )
  const contentViews = await queryOne<{ v: number }>(
    `SELECT COALESCE(SUM(views), 0) as v FROM content`
  )
  return NextResponse.json({
    cleaned_at: cleaned?.value ?? null,
    total_revenue_logs: revTotal?.t ?? 0,
    total_content_views: contentViews?.v ?? 0,
  })
}
