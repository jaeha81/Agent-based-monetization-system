import { NextResponse } from 'next/server'
import { runFullCycle } from '@/lib/agents/orchestrator'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST() {
  console.log('[Orchestrator] 전체 에이전트 사이클 시작')
  const started = Date.now()
  try {
    const result = await runFullCycle()
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    return NextResponse.json({ ok: true, elapsed: `${elapsed}s`, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
