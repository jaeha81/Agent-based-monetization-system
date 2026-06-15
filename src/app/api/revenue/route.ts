import { NextResponse } from 'next/server'
import { getRevenueSummary } from '@/lib/agents/revenue-agent'

export async function GET() {
  const summary = getRevenueSummary()
  return NextResponse.json(summary)
}
