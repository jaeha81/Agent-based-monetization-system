import { NextRequest, NextResponse } from 'next/server'
import { runBrainScan, getActiveProblems, resolveProblem } from '@/lib/agent-brain'

// GET /api/agent/brain — 활성 문제 목록 (가볍게)
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

// PATCH /api/agent/brain?id=N — 문제 해결 처리
export async function PATCH(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  try {
    await resolveProblem(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
