import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import { getProductionConfigurationStatus } from '@/lib/provider-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [runs, postsByStatus, productCount, contentByStatus, failedRenders] = await Promise.all([
    query('SELECT id, run_type, status, products_found, content_generated, posts_published, error, started_at, finished_at FROM automation_runs ORDER BY id DESC LIMIT 5'),
    query('SELECT status, COUNT(*) as c FROM scheduled_posts GROUP BY status'),
    query('SELECT COUNT(*) as c FROM products'),
    query('SELECT status, COUNT(*) as c FROM content GROUP BY status'),
    query<{ id: number; error: string | null; created_at: string }>(
      `SELECT id, error, created_at FROM workflow_jobs WHERE node_type='video_render' AND status='failed' ORDER BY created_at DESC LIMIT 5`
    ),
  ])
  const configuration = getProductionConfigurationStatus()
  return NextResponse.json({
    automation_runs: runs,
    scheduled_posts: postsByStatus,
    products: productCount,
    content: contentByStatus,
    db_url: process.env.TURSO_DATABASE_URL ? 'turso' : 'local',
    mock_mode: process.env.USE_MOCK_DATA,
    configuration: { ok: configuration.ok, configured: configuration.configured },
    live_verification: 'run POST /api/setup/verify on demand',
    failed_renders: failedRenders,
  })
}
