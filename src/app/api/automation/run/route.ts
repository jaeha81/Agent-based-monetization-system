import { NextResponse } from 'next/server'
import { runDailyAutomation } from '@/lib/automation-engine'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST() {
  console.log('[API] 수동 자동화 실행 요청')
  try {
    const result = await runDailyAutomation()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
