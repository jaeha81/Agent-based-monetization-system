import { NextRequest, NextResponse } from 'next/server'
import { startWorkflow } from '@/lib/workflow-engine'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  console.log('[API] 워크플로우 수동 실행 요청')
  const body = await req.json().catch(() => ({})) as { keyword?: string; market?: string }

  try {
    const result = await startWorkflow('daily_pipeline', 'manual', {
      keyword: body.keyword,
      market: body.market || 'KR',
      language: 'ko',
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
