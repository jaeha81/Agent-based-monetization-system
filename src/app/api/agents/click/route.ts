import { NextRequest, NextResponse } from 'next/server'
import { runClickAgent } from '@/lib/agents/click-agent'

export async function POST(req: NextRequest) {
  try {
    const { productName, category, existingHook, language } = await req.json() as {
      productName: string; category: string; existingHook?: string; language?: string
    }
    if (!productName) return NextResponse.json({ error: '제품명 필요' }, { status: 400 })
    const result = await runClickAgent(productName, category || '전체', existingHook, language || 'ko')
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
