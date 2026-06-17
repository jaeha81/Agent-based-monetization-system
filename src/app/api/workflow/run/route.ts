import { NextRequest, NextResponse } from 'next/server'
import { startWorkflow, processPendingJobs } from '@/lib/workflow-engine'

export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
    || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

// POST /api/workflow/run
// Body: { workflow?: string, trigger?: string, keyword?: string, market?: string }
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    workflow?: string
    trigger?: string
    keyword?: string
    market?: string
    language?: string
  }

  const workflowName = body.workflow || 'daily_pipeline'
  const triggerType = (body.trigger || 'manual') as 'cron' | 'manual' | 'webhook'

  const started = Date.now()
  try {
    const result = await startWorkflow(workflowName, triggerType, {
      keyword: body.keyword,
      market: body.market,
      language: body.language,
    })
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    return NextResponse.json({ ok: true, elapsed: `${elapsed}s`, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// GET /api/workflow/run?process=true — 대기 중인 잡 처리
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workflowName = req.nextUrl.searchParams.get('workflow') || undefined
  const processed = await processPendingJobs(workflowName)
  return NextResponse.json({ ok: true, processed })
}
