import { NextRequest, NextResponse } from 'next/server'
import { startWorkflow } from '@/lib/workflow-engine'

export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron/Daily] 워크플로우 엔진 사이클 시작')
  const started = Date.now()

  try {
    const result = await startWorkflow('daily_pipeline', 'cron')
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`[Cron/Daily] 완료 — ${elapsed}s rootJob=${result.rootJobId}`)
    return NextResponse.json({ ok: true, elapsed: `${elapsed}s`, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Cron/Daily] 오류:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
