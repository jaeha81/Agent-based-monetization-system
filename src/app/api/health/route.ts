import { NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const start = Date.now()
  const checks: Record<string, { ok: boolean; ms?: number; reason?: string }> = {}

  // DB check
  try {
    await queryOne('SELECT 1 as ok')
    checks.db = { ok: true, ms: Date.now() - start }
  } catch (e) {
    checks.db = { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }

  // Gemini API key present
  checks.gemini = { ok: !!process.env.GEMINI_API_KEY }
  checks.coupang = { ok: !!(process.env.COUPANG_ACCESS_KEY && process.env.COUPANG_SECRET_KEY) }
  checks.youtube = { ok: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN) }
  checks.shotstack = { ok: !!process.env.SHOTSTACK_API_KEY }
  checks.tistory = { ok: !!process.env.TISTORY_ACCESS_TOKEN }
  checks.discord = { ok: !!process.env.SHORTS_DISCORD_WEBHOOK }

  const allOk = checks.db.ok && checks.gemini.ok && checks.coupang.ok
  const status = allOk ? 200 : 503

  return NextResponse.json(
    { status: allOk ? 'ok' : 'degraded', checks, uptime: process.uptime?.() ?? 0, ts: new Date().toISOString() },
    { status }
  )
}
