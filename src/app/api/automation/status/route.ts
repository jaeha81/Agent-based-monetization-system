import { NextResponse } from 'next/server'
import { getAutomationStatus } from '@/lib/automation-engine'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const status = getAutomationStatus()
    return NextResponse.json({ ok: true, ...status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
