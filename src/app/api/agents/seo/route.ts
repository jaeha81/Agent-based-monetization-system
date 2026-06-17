import { NextRequest, NextResponse } from 'next/server'
import { runSeoAgent } from '@/lib/agents/seo-agent'

export async function POST(req: NextRequest) {
  try {
    const { productName, category, market } = await req.json() as {
      productName: string; category: string; market?: string
    }
    if (!productName) return NextResponse.json({ error: '제품명 필요' }, { status: 400 })
    const result = await runSeoAgent(productName, category || '전체', market || 'KR')
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
