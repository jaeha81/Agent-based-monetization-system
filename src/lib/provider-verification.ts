import { getDatabaseDiagnostics } from '@/lib/db'
import { verifyCoupangCredentials } from '@/lib/coupang'
import { verifyYouTubeCredentials } from '@/lib/youtube'

export type ProviderVerificationState = 'valid' | 'partial' | 'invalid' | 'missing' | 'unavailable'
export type ProviderName = 'database' | 'gemini' | 'coupang' | 'youtube' | 'shotstack' | 'tts'

export interface ProviderVerificationResult {
  state: ProviderVerificationState
  latencyMs: number
  message: string
  capabilities?: Record<string, boolean>
}

const REQUIRED_KEYS = [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'GEMINI_API_KEY', 'CRON_SECRET',
  'DASHBOARD_PASSWORD', 'UPLOAD_SECRET', 'COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY',
  'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN',
  'SHOTSTACK_API_KEY', 'SHOTSTACK_WEBHOOK_SECRET', 'GOOGLE_TTS_API_KEY',
  'TTS_SIGNING_SECRET', 'CLICK_HASH_SECRET', 'NEXT_PUBLIC_APP_URL',
] as const

const SECRET_KEYS = [
  'CRON_SECRET', 'DASHBOARD_PASSWORD', 'UPLOAD_SECRET', 'SHOTSTACK_WEBHOOK_SECRET',
  'TTS_SIGNING_SECRET', 'CLICK_HASH_SECRET',
] as const

function value(key: string): string {
  return (process.env[key] || '').replace(/^﻿/, '').trim()
}

export function getProductionConfigurationStatus(): {
  ok: boolean
  configured: Record<string, boolean>
  failures: string[]
  warnings: string[]
} {
  const configured = Object.fromEntries(REQUIRED_KEYS.map(key => [key, Boolean(value(key))]))
  configured.YOUTUBE_API_KEY = Boolean(value('YOUTUBE_API_KEY') || value('GOOGLE_API_KEY'))
  const failures: string[] = []
  const warnings: string[] = []

  for (const key of REQUIRED_KEYS) if (!configured[key]) failures.push(`${key}:missing`)
  if (!configured.YOUTUBE_API_KEY) failures.push('YOUTUBE_API_KEY:missing')
  for (const key of SECRET_KEYS) if (value(key) && value(key).length < 24) failures.push(`${key}:too_short`)
  for (let left = 0; left < SECRET_KEYS.length; left++) {
    for (let right = left + 1; right < SECRET_KEYS.length; right++) {
      const a = value(SECRET_KEYS[left])
      const b = value(SECRET_KEYS[right])
      if (a && a === b) failures.push(`${SECRET_KEYS[left]}:${SECRET_KEYS[right]}:reused`)
    }
  }
  if (value('SHOTSTACK_STAGE') !== 'v1') failures.push('SHOTSTACK_STAGE:not_v1')
  if (value('USE_MOCK_DATA') === 'true') failures.push('USE_MOCK_DATA:enabled')
  if (value('NEXT_PUBLIC_APP_URL') && !/^https:\/\//i.test(value('NEXT_PUBLIC_APP_URL'))) failures.push('NEXT_PUBLIC_APP_URL:not_https')
  if (!value('COUPANG_SUB_ID')) warnings.push('COUPANG_SUB_ID:missing')
  if (value('AUTO_PUBLISH_ENABLED') !== 'true') warnings.push('AUTO_PUBLISH_ENABLED:disabled')

  return { ok: failures.length === 0, configured, failures, warnings }
}

async function timed(
  probe: (signal: AbortSignal) => Promise<Omit<ProviderVerificationResult, 'latencyMs'>>
): Promise<ProviderVerificationResult> {
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    return { ...(await probe(controller.signal)), latencyMs: Date.now() - started }
  } catch (error) {
    return {
      state: error instanceof Error && error.name === 'AbortError' ? 'unavailable' : 'invalid',
      latencyMs: Date.now() - started,
      message: error instanceof Error && error.name === 'AbortError' ? '응답 시간 초과' : '인증 확인 실패',
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function verifyDatabase(): Promise<ProviderVerificationResult> {
  if (!value('TURSO_DATABASE_URL') || !value('TURSO_AUTH_TOKEN')) {
    return { state: 'missing', latencyMs: 0, message: '운영 DB 자격증명 미설정' }
  }
  const started = Date.now()
  try {
    const diagnostics = await getDatabaseDiagnostics()
    const schemaReady = diagnostics.schemaVersion === diagnostics.expectedVersion
    return {
      state: schemaReady ? 'valid' : 'partial',
      latencyMs: Date.now() - started,
      message: schemaReady ? '연결 및 스키마 확인 완료' : '연결됨 · 스키마 버전 불일치',
      capabilities: { schemaReady },
    }
  } catch {
    return { state: 'invalid', latencyMs: Date.now() - started, message: '운영 DB 연결 실패' }
  }
}

async function verifyGemini(): Promise<ProviderVerificationResult> {
  const key = value('GEMINI_API_KEY')
  if (!key) return { state: 'missing', latencyMs: 0, message: 'API 키 미설정' }
  return timed(async signal => {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`, { signal })
    return response.ok
      ? { state: 'valid', message: '모델 목록 인증 완료' }
      : { state: response.status === 401 || response.status === 403 ? 'invalid' : 'unavailable', message: `모델 API HTTP ${response.status}` }
  })
}

async function verifyCoupang(): Promise<ProviderVerificationResult> {
  const started = Date.now()
  const result = await verifyCoupangCredentials()
  return {
    state: result.ok ? 'valid' : result.reason === 'missing' ? 'missing' : result.reason === 'invalid' ? 'invalid' : 'unavailable',
    latencyMs: Date.now() - started,
    message: result.ok ? 'Reporting API 인증 완료' : result.reason === 'missing' ? 'API 키 미설정' : 'Reporting API 인증 실패',
    capabilities: { reports: result.reports },
  }
}

async function verifyYouTube(): Promise<ProviderVerificationResult> {
  const started = Date.now()
  const result = await verifyYouTubeCredentials()
  const state: ProviderVerificationState = result.ok
    ? result.monetary ? 'valid' : 'partial'
    : result.reason === 'missing' ? 'missing' : result.reason === 'unavailable' ? 'unavailable' : 'invalid'
  return {
    state,
    latencyMs: Date.now() - started,
    message: state === 'valid' ? 'OAuth 및 수익 scope 확인 완료'
      : state === 'partial' ? 'OAuth 정상 · 수익 scope 미확인'
        : result.reason === 'missing' ? 'OAuth 자격증명 미설정' : 'OAuth 또는 scope 확인 실패',
    capabilities: { analytics: result.analytics, monetary: result.monetary },
  }
}

async function verifyShotstack(): Promise<ProviderVerificationResult> {
  const key = value('SHOTSTACK_API_KEY')
  if (!key) return { state: 'missing', latencyMs: 0, message: 'API 키 미설정' }
  const stage = value('SHOTSTACK_STAGE') === 'v1' ? 'v1' : 'stage'
  return timed(async signal => {
    const response = await fetch(
      `https://api.shotstack.io/edit/${stage}/render/00000000-0000-4000-8000-000000000000?data=false`,
      { headers: { 'x-api-key': key }, signal }
    )
    if (response.ok || response.status === 400 || response.status === 404) {
      return { state: stage === 'v1' ? 'valid' : 'partial', message: stage === 'v1' ? '프로덕션 키 인증 완료' : 'stage 키 인증 완료' }
    }
    return {
      state: response.status === 401 || response.status === 403 ? 'invalid' : 'unavailable',
      message: `Edit API HTTP ${response.status}`,
    }
  })
}

async function verifyTts(): Promise<ProviderVerificationResult> {
  const key = value('GOOGLE_TTS_API_KEY')
  if (!key) return { state: 'missing', latencyMs: 0, message: 'API 키 미설정' }
  return timed(async signal => {
    const response = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=ko-KR&key=${encodeURIComponent(key)}`, { signal })
    return response.ok
      ? { state: 'valid', message: '한국어 음성 목록 인증 완료' }
      : { state: response.status === 401 || response.status === 403 ? 'invalid' : 'unavailable', message: `TTS API HTTP ${response.status}` }
  })
}

export async function verifyProductionProviders(
  requested?: ProviderName[]
): Promise<Partial<Record<ProviderName, ProviderVerificationResult>>> {
  const providers = requested?.length
    ? Array.from(new Set(requested))
    : ['database', 'gemini', 'coupang', 'youtube', 'shotstack', 'tts'] as ProviderName[]
  const probes: Record<ProviderName, () => Promise<ProviderVerificationResult>> = {
    database: verifyDatabase,
    gemini: verifyGemini,
    coupang: verifyCoupang,
    youtube: verifyYouTube,
    shotstack: verifyShotstack,
    tts: verifyTts,
  }
  const entries = await Promise.all(providers.map(async provider => [provider, await probes[provider]()] as const))
  return Object.fromEntries(entries)
}
