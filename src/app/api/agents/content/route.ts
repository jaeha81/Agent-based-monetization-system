import { NextRequest, NextResponse } from 'next/server'
import { runContentAgent } from '@/lib/agents/content-agent'

export async function POST(req: NextRequest) {
  try {
    const { productId, productName, category, price } = await req.json()
    if (!productName) return NextResponse.json({ error: '제품명을 입력해 주세요' }, { status: 400 })

    const result = await runContentAgent(productId || 1, productName, category || '전체', price)
    return NextResponse.json(result)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: '콘텐츠 생성 실패' }, { status: 500 })
  }
}
