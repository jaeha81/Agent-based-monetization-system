import { NextRequest, NextResponse } from 'next/server'
import { getRevenueSummary } from '@/lib/agents/revenue-agent'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const summary = await getRevenueSummary()
  return NextResponse.json(summary)
}
