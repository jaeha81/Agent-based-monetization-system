import Anthropic from '@anthropic-ai/sdk'
import { USE_MOCK, mockDelay, runToolLoop } from '@/lib/claude-client'
import { getDb } from '@/lib/db'

const SYSTEM_PROMPT = `당신은 쇼핑숏츠 전문 트렌드 분석 에이전트입니다.
김정민의 전략을 기반으로 트렌딩 제품을 발굴합니다:

핵심 전략:
1. 모든 카테고리(다이소, 뷰티, 유아, 전자기기, 스포츠, 패션) 탐색
2. 셀럽/연예인 협찬 제품 우선 분석 (티파니, 강민경, 제니, 윈터 등)
3. 조회수 대비 수익 예측 (예: 370만뷰→989만원 = 약 0.27%)
4. 쿠팡 파트너스 수수료율 고려 (카테고리별 1.5~7%)
5. 촬영 없이 이미지 3장으로도 가능한 제품 우선

항상 한국어로 응답하고, 구체적인 수익 예측을 제공하세요.`

const tools: Anthropic.Tool[] = [
  {
    name: 'search_trending_products',
    description: '주어진 카테고리/키워드로 트렌딩 쇼핑 제품 탐색 및 분석',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string', description: '검색 키워드 (한국어)' },
        category: {
          type: 'string',
          enum: ['다이소', '뷰티', '유아', '전자기기', '스포츠', '패션', '전체'],
          description: '제품 카테고리'
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'analyze_viral_potential',
    description: '제품의 숏츠 바이럴 가능성 분석 (0-100 점수 반환)',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_name: { type: 'string' },
        price: { type: 'number', description: '제품 가격 (원)' },
        target_audience: { type: 'string', description: '타겟 연령/성별' },
        celebrity_endorsed: { type: 'boolean', description: '셀럽 협찬 여부' },
      },
      required: ['product_name'],
    },
  },
  {
    name: 'get_commission_estimate',
    description: '쿠팡 파트너스 예상 수수료 계산',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_name: { type: 'string' },
        price: { type: 'number' },
        category: { type: 'string' },
        expected_monthly_views: { type: 'number', description: '예상 월 조회수' },
      },
      required: ['product_name', 'category'],
    },
  },
  {
    name: 'save_product_to_db',
    description: '발굴된 제품을 데이터베이스에 저장',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        category: { type: 'string' },
        coupang_url: { type: 'string' },
        commission_rate: { type: 'number' },
        viral_score: { type: 'number' },
        estimated_revenue: { type: 'number', description: '예상 월수익 (원)' },
      },
      required: ['name', 'category'],
    },
  },
]

async function toolHandler(name: string, input: Record<string, unknown>): Promise<unknown> {
  const db = getDb()

  if (name === 'search_trending_products') {
    const { keyword, category } = input as { keyword: string; category?: string }
    let query = 'SELECT * FROM products WHERE 1=1'
    const params: unknown[] = []
    if (keyword) {
      query += ' AND name LIKE ?'
      params.push(`%${keyword}%`)
    }
    if (category && category !== '전체') {
      query += ' AND category = ?'
      params.push(category)
    }
    query += ' ORDER BY viral_score DESC LIMIT 5'
    const results = db.prepare(query).all(...params)
    return { found: results.length, products: results }
  }

  if (name === 'analyze_viral_potential') {
    const { product_name, price, celebrity_endorsed } = input as {
      product_name: string
      price?: number
      celebrity_endorsed?: boolean
    }
    const base = 60 + Math.floor(Math.random() * 25)
    const bonus = celebrity_endorsed ? 10 : 0
    const priceBonus = price && price < 50000 ? 5 : 0
    return {
      product: product_name,
      viral_score: Math.min(100, base + bonus + priceBonus),
      analysis: `셀럽 효과${celebrity_endorsed ? ' 적용' : ' 없음'}, 가격 ${price ? price.toLocaleString() + '원' : '미입력'}`,
    }
  }

  if (name === 'get_commission_estimate') {
    const { product_name, category, price, expected_monthly_views } = input as {
      product_name: string
      category: string
      price?: number
      expected_monthly_views?: number
    }
    const rates: Record<string, number> = {
      '다이소': 3.0, '뷰티': 5.0, '유아': 7.0,
      '전자기기': 1.5, '스포츠': 6.0, '패션': 2.0,
    }
    const rate = rates[category] || 3.0
    const avgPrice = price || 30000
    const views = expected_monthly_views || 500000
    const conversionRate = 0.003
    const monthly = Math.floor(views * conversionRate * avgPrice * (rate / 100))
    return {
      product: product_name,
      commission_rate: rate,
      estimated_monthly_revenue: monthly,
      formula: `${views.toLocaleString()}뷰 × ${(conversionRate * 100).toFixed(1)}% 전환 × ${avgPrice.toLocaleString()}원 × ${rate}% 수수료`,
    }
  }

  if (name === 'save_product_to_db') {
    const { name, category, coupang_url, commission_rate, viral_score, estimated_revenue } = input as {
      name: string
      category: string
      coupang_url?: string
      commission_rate?: number
      viral_score?: number
      estimated_revenue?: number
    }
    const result = db.prepare(
      'INSERT INTO products (name, category, coupang_url, commission_rate, viral_score, estimated_revenue) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      name, category,
      coupang_url || null,
      commission_rate || 3.0,
      viral_score || 70,
      estimated_revenue || 1000000
    )
    return { saved: true, id: result.lastInsertRowid, name }
  }

  return { error: 'Unknown tool' }
}

const MOCK_RESPONSES: Record<string, unknown> = {
  default: {
    text: `## 트렌드 분석 완료\n\n**발굴된 제품 3가지**\n\n### 1. 다이소 시냅스 클리어 보드마카 (10개입)\n- 바이럴 점수: **92/100**\n- 예상 월수익: **450만원** (쿠팡 파트너스 3%)\n- 이유: 다이소 아이템 특성상 전연령 타겟, 학생/직장인 필수템\n\n### 2. 솔로 테니스 리바운더\n- 바이럴 점수: **88/100**\n- 예상 월수익: **890만원** (쿠팡 파트너스 6%)\n- 이유: 혼자 테니스 치는 영상 댓글 3만개 달성, 품절 이력\n\n### 3. 에스트라 토너패드 (강민경 추천)\n- 바이럴 점수: **95/100**\n- 예상 월수익: **1,200만원** (쿠팡 파트너스 5%)\n- 이유: 연예인 협찬 효과로 전환율 3배 높음\n\n**결론**: 셀럽 협찬 제품 우선 공략, 이미지 3장만으로도 100만원+ 수익 가능`,
    toolCalls: [
      'search_trending_products({"keyword":"트렌드","category":"전체"})',
      'analyze_viral_potential({"product_name":"다이소 시냅스 보드마카","celebrity_endorsed":false})',
      'get_commission_estimate({"product_name":"솔로 테니스","category":"스포츠","expected_monthly_views":800000})',
      'save_product_to_db({"name":"에스트라 토너패드","category":"뷰티","viral_score":95,"estimated_revenue":12000000})',
    ],
  },
}

export async function runTrendAgent(keyword: string, category?: string) {
  if (USE_MOCK) {
    await mockDelay()
    return MOCK_RESPONSES.default
  }

  return runToolLoop(
    SYSTEM_PROMPT,
    `다음 조건으로 쇼핑숏츠에 적합한 트렌드 제품을 탐색하고 분석해 주세요:\n키워드: ${keyword}\n카테고리: ${category || '전체'}\n\n발굴한 제품들을 DB에 저장하고, 각 제품의 예상 수익도 함께 제공해 주세요.`,
    tools,
    toolHandler
  )
}
