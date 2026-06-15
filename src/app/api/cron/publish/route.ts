import { NextRequest, NextResponse } from 'next/server'
import { publishScheduledPosts } from '@/lib/automation-engine'

export const runtime = 'nodejs'
export const maxDuration = 120

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron/Publish] 예약 게시 시작')

  try {
    const result = await publishScheduledPosts()
    console.log('[Cron/Publish] 완료:', result)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
