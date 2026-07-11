import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'

// Shotstack sandbox 렌더 24h 만료로 영구 waiting 상태에 빠진 잡들을 failed로 정리
export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2시간 이상 waiting 상태인 잡들
  type StaleJob = { id: number; render_id: string; content_id: number; created_at: string }
  const stale = await query<StaleJob>(
    `SELECT id, render_id, content_id, created_at FROM workflow_jobs
     WHERE status = 'waiting'
       AND created_at < datetime('now', '-2 hours')`
  )

  if (stale.length === 0) {
    return NextResponse.json({ ok: true, cleaned: 0, message: '만료된 waiting 잡 없음' })
  }

  const ids = stale.map((j: StaleJob) => j.id)
  const placeholders = ids.map(() => '?').join(',')

  await execute(
    `UPDATE workflow_jobs SET status = 'failed', error = 'Shotstack sandbox render expired (24h TTL)', completed_at = datetime('now')
     WHERE id IN (${placeholders})`,
    ids
  )

  // content 테이블의 render_id/render_status도 정리
  const contentIds = stale.map((j: StaleJob) => j.content_id).filter(Boolean)
  if (contentIds.length > 0) {
    const cp = contentIds.map(() => '?').join(',')
    await execute(
      `UPDATE content SET render_id = NULL, render_status = 'failed' WHERE id IN (${cp})`,
      contentIds
    )
  }

  return NextResponse.json({
    ok: true,
    cleaned: ids.length,
    job_ids: ids,
    message: `${ids.length}개 만료 waiting 잡 → failed 처리 완료`,
  })
}
