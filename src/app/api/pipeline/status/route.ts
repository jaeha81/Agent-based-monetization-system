import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [jobs, runs, recentContent] = await Promise.all([
      // 최근 workflow_jobs (파이프라인 단계별 상태)
      query(`
        SELECT id, workflow_name, node_type, trigger_type, status,
               content_id, product_id, render_id, error,
               created_at, started_at, completed_at
        FROM workflow_jobs
        ORDER BY id DESC
        LIMIT 30
      `),

      // 최근 자동화 런
      query(`
        SELECT id, run_type, status, products_found, content_generated,
               posts_published, error, started_at, finished_at
        FROM automation_runs
        ORDER BY id DESC
        LIMIT 5
      `),

      // 렌더/업로드 현황 있는 최근 콘텐츠
      query(`
        SELECT c.id, c.hook, c.platform, c.render_status, c.upload_status,
               c.youtube_url, c.video_url, c.created_at,
               p.name as product_name
        FROM content c
        LEFT JOIN products p ON c.product_id = p.id
        WHERE (c.render_status IS NOT NULL AND c.render_status != 'idle') OR c.video_url IS NOT NULL
        ORDER BY c.id DESC
        LIMIT 15
      `).catch(() =>
        // render_status 컬럼 없을 경우 fallback
        query(`
          SELECT c.id, c.hook, c.platform, c.status as render_status,
                 NULL as upload_status, c.video_url as youtube_url, c.video_url, c.created_at,
                 p.name as product_name
          FROM content c
          LEFT JOIN products p ON c.product_id = p.id
          ORDER BY c.id DESC
          LIMIT 15
        `)
      ),
    ])

    // qa_result를 별도 쿼리 (컬럼 미존재 시 무시)
    const qaMap: Record<number, number> = {}
    try {
      const qaRows = await query<{ id: number; qa_result: string | null }>(`
        SELECT id, qa_result FROM content
        WHERE qa_result IS NOT NULL
        ORDER BY id DESC LIMIT 30
      `)
      for (const row of qaRows) {
        if (row.id && row.qa_result) {
          try {
            const parsed = JSON.parse(row.qa_result as string)
            qaMap[row.id] = parsed.score ?? 0
          } catch {
            qaMap[row.id] = 0
          }
        }
      }
    } catch { /* qa_result 컬럼 없음 */ }

    // 파이프라인 단계 집계
    const stageStats = {
      product_discovery: { total: 0, done: 0, failed: 0 },
      content_generation: { total: 0, done: 0, failed: 0 },
      video_render: { total: 0, done: 0, failed: 0 },
      youtube_upload: { total: 0, done: 0, failed: 0 },
    }
    for (const job of jobs as Array<{ node_type: string; status: string }>) {
      const key = job.node_type as keyof typeof stageStats
      if (stageStats[key]) {
        stageStats[key].total++
        if (job.status === 'done' || job.status === 'completed') stageStats[key].done++
        if (job.status === 'failed' || job.status === 'error') stageStats[key].failed++
      }
    }

    return NextResponse.json({
      ok: true,
      jobs,
      runs,
      recentContent: (recentContent as Array<{ id: number } & Record<string, unknown>>).map(c => ({
        ...c,
        qa_score: qaMap[c.id] ?? null,
      })),
      stageStats,
      updatedAt: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
