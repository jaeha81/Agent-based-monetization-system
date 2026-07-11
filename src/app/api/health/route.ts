import { NextRequest, NextResponse } from 'next/server'
import { getDatabaseDiagnostics, queryOne } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import { getProductionConfigurationStatus } from '@/lib/provider-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const start = Date.now()
  const checks: Record<string, { ok: boolean; ms?: number; reason?: string }> = {}
  let database: Awaited<ReturnType<typeof getDatabaseDiagnostics>> | null = null

  // DB check
  try {
    await queryOne('SELECT 1 as ok')
    const db = await getDatabaseDiagnostics()
    database = db
    checks.db = {
      ok: db.schemaVersion === db.expectedVersion && db.latencyMs < 3000,
      ms: Date.now() - start,
      ...((db.schemaVersion !== db.expectedVersion || db.latencyMs >= 3000)
        ? { reason: `schema=${db.schemaVersion}/${db.expectedVersion}, latency=${db.latencyMs}ms` }
        : {}),
    }
  } catch {
    checks.db = { ok: false, reason: 'DB 연결 실패' }
  }

  const configuration = getProductionConfigurationStatus()
  checks.gemini = { ok: configuration.configured.GEMINI_API_KEY }
  checks.coupang = { ok: configuration.configured.COUPANG_ACCESS_KEY && configuration.configured.COUPANG_SECRET_KEY }
  checks.youtube = { ok: configuration.configured.YOUTUBE_CLIENT_ID && configuration.configured.YOUTUBE_CLIENT_SECRET && configuration.configured.YOUTUBE_REFRESH_TOKEN }
  checks.youtubeTrends = { ok: configuration.configured.YOUTUBE_API_KEY }
  checks.shotstack = { ok: configuration.configured.SHOTSTACK_API_KEY && process.env.SHOTSTACK_STAGE === 'v1' }
  checks.tts = { ok: (configuration.configured.GOOGLE_TTS_API_KEY || configuration.configured.LOCAL_TTS_URL) && configuration.configured.TTS_SIGNING_SECRET }
  checks.operationalDb = { ok: configuration.configured.TURSO_DATABASE_URL && configuration.configured.TURSO_AUTH_TOKEN }
  checks.affiliateTracking = { ok: checks.coupang.ok && !!process.env.COUPANG_SUB_ID }
  checks.autoPublish = { ok: process.env.AUTO_PUBLISH_ENABLED === 'true', reason: process.env.AUTO_PUBLISH_ENABLED === 'true' ? undefined : '안전상 비활성' }
  const shotstackCircuit = await queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'circuit:shotstack'").catch(() => undefined)
  if (shotstackCircuit?.value === 'open') checks.shotstack = { ok: false, reason: '회로 열림: 크레딧/할당량 오류' }
  checks.tistory = { ok: !!process.env.TISTORY_ACCESS_TOKEN }
  checks.discord = { ok: !!process.env.SHORTS_DISCORD_WEBHOOK }

  const allOk = checks.db.ok && configuration.ok && checks.shotstack.ok && checks.tts.ok
  const status = allOk ? 200 : 503

  const detailed = await isAdminRequest(req)
  return NextResponse.json(
    detailed
      ? { status: allOk ? 'ok' : 'degraded', checks, configuration: { ok: configuration.ok, failures: configuration.failures, warnings: configuration.warnings }, database, uptime: process.uptime?.() ?? 0, ts: new Date().toISOString() }
      : { status: allOk ? 'ok' : 'degraded', ts: new Date().toISOString() },
    { status }
  )
}
