import { NextRequest, NextResponse } from 'next/server'
import { getWorkflowStatus } from '@/lib/workflow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const workflowName = req.nextUrl.searchParams.get('workflow') || undefined
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')

  const jobs = await getWorkflowStatus(workflowName, limit)

  // 노드별 집계
  const summary = jobs.reduce((acc, job) => {
    const key = job.status as string
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return NextResponse.json({ jobs, summary, total: jobs.length })
}
