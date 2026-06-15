import { NextResponse } from 'next/server'
import { getAgentDashboard } from '@/lib/agents/orchestrator'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const data = getAgentDashboard()
    return NextResponse.json({ ok: true, ...data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
