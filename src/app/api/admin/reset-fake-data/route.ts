import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'

// 오케스트레이터가 생성한 가짜 수익/조회수 데이터를 1회 초기화
export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) {
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
    `UPDATE content SET views = 0, revenue = 0, likes = 0, comments = 0, click_count = 0,
     avg_view_duration = 0, avg_view_percentage = 0, performance_score = 0,
     metrics_source = NULL, metrics_window_start = NULL, metrics_window_end = NULL`
  )
  const resetClicks = await execute(`DELETE FROM click_logs`)

  // 3. products 테이블의 가짜 viral_score, estimated_revenue 초기화
  const resetProducts = await execute(
    `UPDATE products SET viral_score = 0, estimated_revenue = 0, total_views = 0, total_clicks = 0,
     avg_retention = 0, performance_score = 0, selection_score = 0, decision_confidence = 0,
     decision_action = 'learn', decision_reason = '실데이터 재수집 대기', last_performance_sync_at = NULL`
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
    `SELECT COALESCE(SUM(amount), 0) as t FROM revenue_events`
  )

  return NextResponse.json({
    ok: true,
    deleted: {
      revenue_logs: delLogs.rowsAffected,
      content_rows_reset: resetContent.rowsAffected,
      products_reset: resetProducts.rowsAffected,
      click_logs: resetClicks.rowsAffected,
      accounts_reset: resetAccounts.rowsAffected,
    },
    remaining_revenue_events: check?.t ?? 0,
    message: '가짜 데이터 초기화 완료. 실제 YouTube 조회수는 revenue-sync cron 실행 후 복원됩니다.',
  })
}

export async function GET(req: NextRequest) {
  if (!await isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const cleaned = await queryOne<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'fake_data_cleaned_at'`
  )
  const revTotal = await queryOne<{ t: number }>(
    `SELECT COALESCE(SUM(amount), 0) as t FROM revenue_events`
  )
  const contentViews = await queryOne<{ v: number }>(
    `SELECT COALESCE(SUM(views), 0) as v FROM content`
  )
  return NextResponse.json({
    cleaned_at: cleaned?.value ?? null,
    total_revenue_events: revTotal?.t ?? 0,
    total_content_views: contentViews?.v ?? 0,
  })
}
