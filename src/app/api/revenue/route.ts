import { NextResponse } from 'next/server'
import { getRevenueSummary } from '@/lib/agents/revenue-agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const summary = getRevenueSummary()
  return NextResponse.json(summary)
}
