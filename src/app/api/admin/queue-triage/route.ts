import { NextRequest, NextResponse } from 'next/server'
import { execute, query } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'

export async function GET(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [posts, jobs, stale] = await Promise.all([
    query(`SELECT status, platform, COUNT(*) AS count FROM scheduled_posts GROUP BY status, platform ORDER BY status, platform`),
    query(`SELECT status, node_type, COUNT(*) AS count FROM workflow_jobs GROUP BY status, node_type ORDER BY status, node_type`),
    query(`SELECT id, content_id, platform, scheduled_for, retry_count, error FROM scheduled_posts WHERE status = 'pending' AND scheduled_for < datetime('now', '-24 hours') ORDER BY scheduled_for ASC LIMIT 100`),
  ])
  return NextResponse.json({ posts, jobs, stale, staleCount: stale.length, dryRun: true })
}

export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { confirm?: boolean; reason?: string }
  const candidates = await query<{ id: number }>(`
    SELECT id FROM scheduled_posts
    WHERE status = 'pending' AND scheduled_for < datetime('now', '-24 hours')
      AND (retry_count >= 3 OR error LIKE '%credits required%' OR error LIKE '%plan limits%')
  `)
  if (body.confirm !== true) return NextResponse.json({ dryRun: true, candidates: candidates.length, ids: candidates.map(row => row.id) })
  if (candidates.length === 0) return NextResponse.json({ ok: true, quarantined: 0 })
  const placeholders = candidates.map(() => '?').join(',')
  const result = await execute(
    `UPDATE scheduled_posts SET status = 'quarantined', error = ? WHERE id IN (${placeholders})`,
    [body.reason || '운영 큐 격리: 반복 실패 또는 공급자 할당량 부족', ...candidates.map(row => row.id)]
  )
  return NextResponse.json({ ok: true, quarantined: result.rowsAffected })
}
