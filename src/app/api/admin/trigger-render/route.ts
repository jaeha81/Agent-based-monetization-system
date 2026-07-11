import { NextRequest, NextResponse } from 'next/server'
import { createJob, processJob } from '@/lib/workflow-engine'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const maxDuration = 120

// POST /api/admin/trigger-render
// Body: { contentId: number }
// 기존 draft 콘텐츠에 대해 video_render 잡을 즉시 생성 + 처리
export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { contentId?: number }
  const contentId = Number(body.contentId)
  if (!contentId) {
    return NextResponse.json({ error: 'contentId 필요' }, { status: 400 })
  }

  const jobId = await createJob('manual_render', 'video_render', { contentId }, 'manual')
  await processJob(jobId)

  return NextResponse.json({ ok: true, jobId, contentId })
}
