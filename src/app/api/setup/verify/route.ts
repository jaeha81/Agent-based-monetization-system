import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import {
  getProductionConfigurationStatus,
  verifyProductionProviders,
  type ProviderName,
} from '@/lib/provider-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PROVIDERS = new Set<ProviderName>(['database', 'gemini', 'coupang', 'youtube', 'shotstack', 'tts'])

export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { providers?: string[] }
  const providers = Array.isArray(body.providers)
    ? body.providers.filter((provider): provider is ProviderName => PROVIDERS.has(provider as ProviderName))
    : undefined
  if (Array.isArray(body.providers) && providers?.length !== body.providers.length) {
    return NextResponse.json({ error: '지원하지 않는 공급자가 포함되어 있습니다.' }, { status: 400 })
  }

  const [configuration, verification] = await Promise.all([
    Promise.resolve(getProductionConfigurationStatus()),
    verifyProductionProviders(providers),
  ])
  const states = Object.values(verification).map(result => result?.state)
  const liveReady = states.length > 0 && states.every(state => state === 'valid')
  const blocking = states.some(state => state === 'invalid' || state === 'missing')

  return NextResponse.json({
    ok: configuration.ok && liveReady,
    blocking,
    configuration,
    providers: verification,
    checkedAt: new Date().toISOString(),
  })
}
