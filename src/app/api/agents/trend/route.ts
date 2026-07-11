import { NextRequest, NextResponse } from 'next/server'
import { runTrendAgent } from '@/lib/agents/trend-agent'

export async function POST(req: NextRequest) {
  try {
    const { keyword, category, market } = await req.json()
    if (!keyword) return NextResponse.json({ error: '키워드를 입력해 주세요' }, { status: 400 })

    const result = await runTrendAgent(keyword, category, market || 'KR')
    return NextResponse.json(result)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: '에이전트 실행 실패' }, { status: 500 })
  }
}
