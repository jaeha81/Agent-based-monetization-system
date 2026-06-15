import { USE_MOCK, mockDelay, generateJSON } from '@/lib/claude-client'
import { query, execute } from '@/lib/db'

interface SuggestedProduct {
  name: string
  category: string
  viral_score: number
  estimated_revenue: number
  reason: string
}

interface TrendAnalysis {
  products: SuggestedProduct[]
  insights: string
}

const SYSTEM_PROMPT = `당신은 쇼핑숏츠 전문 트렌드 분석 에이전트입니다.

핵심 전략:
1. 모든 카테고리(다이소, 뷰티, 유아, 전자기기, 스포츠, 패션) 탐색
2. 쿠팡 파트너스 수수료율 고려 (카테고리별 1.5~7%)
3. 조회수 대비 수익 예측
4. 촬영 없이 이미지 3장으로도 가능한 제품 우선

반드시 JSON 형식으로만 응답하세요:
{
  "products": [
    {
      "name": "제품명",
      "category": "카테고리",
      "viral_score": 85,
      "estimated_revenue": 1500000,
      "reason": "바이럴 가능성 이유"
    }
  ],
  "insights": "전체 트렌드 인사이트 요약"
}`

const MOCK_RESULT = {
  text: `## 트렌드 분석 완료\n\n발굴된 제품 3가지\n\n1. **다이소 시냅스 클리어 보드마카** — 바이럴 점수: 92, 예상 월수익: ₩450만\n2. **솔로 테니스 리바운더** — 바이럴 점수: 88, 예상 월수익: ₩890만\n3. **에스트라 토너패드** — 바이럴 점수: 95, 예상 월수익: ₩1,200만`,
  toolCalls: ['generateJSON(trend_analysis)'],
}

export async function runTrendAgent(keyword: string, category?: string) {
  if (USE_MOCK) {
    await mockDelay()
    return MOCK_RESULT
  }

  const existing = await query<{ name: string }>(
    'SELECT name FROM products ORDER BY id DESC LIMIT 20'
  )
  const existingNames = existing.map(p => p.name).join(', ')

  const userPrompt = `키워드: "${keyword}", 카테고리: ${category || '전체'}

현재 DB에 이미 있는 제품 (중복 금지): ${existingNames || '없음'}

위 키워드/카테고리로 쇼핑숏츠에 적합한 트렌딩 제품 3~5개를 발굴해주세요.
쿠팡 파트너스 수익 극대화 관점에서 viral_score(0-100)와 estimated_revenue(월 예상 원화 수익)를 산정하세요.`

  try {
    const analysis = await generateJSON<TrendAnalysis>(SYSTEM_PROMPT, userPrompt)

    const savedIds: number[] = []
    for (const p of analysis.products) {
      const { lastInsertRowid } = await execute(
        'INSERT INTO products (name, category, commission_rate, viral_score, estimated_revenue) VALUES (?, ?, ?, ?, ?)',
        [p.name, p.category, 3.0, p.viral_score, p.estimated_revenue]
      )
      savedIds.push(lastInsertRowid)
    }

    return {
      text: `## 트렌드 분석 완료\n\n${analysis.insights}\n\n저장된 제품 ${savedIds.length}개 (IDs: ${savedIds.join(', ')})`,
      toolCalls: [`generateJSON(trend_analysis, count=${analysis.products.length})`],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `트렌드 분석 실패: ${msg}`, toolCalls: [] }
  }
}
