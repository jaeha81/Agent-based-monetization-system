import { NextRequest, NextResponse } from 'next/server'
import { createJob, processJob } from '@/lib/workflow-engine'

export const runtime = 'nodejs'
export const maxDuration = 120

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get('Authorization') || ''
  const secret = process.env.CRON_SECRET?.trim()
  return !!secret && auth === `Bearer ${secret}`
}

// POST /api/admin/trigger-render
// Body: { contentId: number }
// 기존 draft 콘텐츠에 대해 video_render 잡을 즉시 생성 + 처리
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
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
