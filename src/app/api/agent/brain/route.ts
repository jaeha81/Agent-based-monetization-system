import { NextRequest, NextResponse } from 'next/server'
import { runBrainScan, getActiveProblems, resolveAndFix } from '@/lib/agent-brain'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/agent/brain — 활성 문제 목록
export async function GET() {
  try {
    const problems = await getActiveProblems()
    return NextResponse.json({ problems, count: problems.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// POST /api/agent/brain — 전체 두뇌 스캔 실행
export async function POST() {
  try {
    const result = await runBrainScan()
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// PATCH /api/agent/brain?id=N — 문제 자가 복구 실행 (단순 resolved 마킹 아님)
export async function PATCH(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  try {
    const result = await resolveAndFix(id)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ ok: false, action: 'error', detail: String(e) }, { status: 500 })
  }
}
