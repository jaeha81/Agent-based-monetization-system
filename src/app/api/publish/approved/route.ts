import { NextRequest, NextResponse } from 'next/server'
import { publishQaApprovedVideos } from '@/lib/publish-gate'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await publishQaApprovedVideos()
  return NextResponse.json({ ok: true, autoPublishEnabled: process.env.AUTO_PUBLISH_ENABLED === 'true', ...result })
}
