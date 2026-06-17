import { execute, query } from '@/lib/db'
import { USE_MOCK, mockDelay, generateJSON } from '@/lib/claude-client'

const SYSTEM_PROMPT = `당신은 클릭율(CTR) 최적화 전문가입니다. 제휴 마케팅 콘텐츠의 클릭율을 극대화합니다.

클릭 유도 심리 기법:
1. 희소성 (Scarcity): "한정수량", "오늘만", "재고 소진 전"
2. 긴급성 (Urgency): "지금 바로", "마감 임박", "이번 주만"
3. 사회적 증명 (Social Proof): "누적 판매 10만개", "리뷰 4.9점"
4. 호기심 갭 (Curiosity Gap): "이걸 모르면 손해", "충격 실화"
5. 가격 앵커링 (Price Anchoring): "정가 5만원 → 지금 2만원"
6. 이익 프레임 (Benefit Frame): 기능이 아닌 이익으로 설명

고성능 훅 패턴:
- 질문형: "○○ 쓰면 왜 이렇게 돼요?"
- 충격형: "이거 절대 그냥 지나치지 마세요"
- 숫자형: "단돈 2만원으로 ○○하는 방법"
- 비교형: "다이소 vs 브랜드, 진짜 승자는?"
- 스토리형: "이거 사고 남편이 처음으로 칭찬해줬어요"

반드시 JSON 형식으로만 응답:
{
  "optimized_hooks": [
    { "hook": "훅 텍스트", "trigger": "사용된 심리 기법", "expected_ctr": "예상 CTR %" }
  ],
  "best_cta": "최적 CTA 문구",
  "urgency_element": "긴급성 요소",
  "social_proof": "사회적 증명 요소"
}`

interface ClickOptResult {
  optimized_hooks: Array<{ hook: string; trigger: string; expected_ctr: string }>
  best_cta: string
  urgency_element: string
  social_proof: string
}

export async function runClickAgent(
  productName: string,
  category: string,
  existingHook?: string,
  language: string = 'ko',
): Promise<ClickOptResult> {
  if (USE_MOCK) {
    await mockDelay(800)
    return {
      optimized_hooks: [
        { hook: `이거 모르면 ${productName} 살 자격 없음`, trigger: '호기심 갭', expected_ctr: '8.5%' },
        { hook: `단돈 2만원? ${productName} 실화냐`, trigger: '가격 앵커링', expected_ctr: '7.2%' },
        { hook: `${productName} 사고 남편이 처음으로 칭찬`, trigger: '스토리', expected_ctr: '6.9%' },
      ],
      best_cta: '지금 최저가 확인 (오늘만 이 가격)',
      urgency_element: '재고 소진 임박',
      social_proof: '구매자 4.9점 / 리뷰 2,847개',
    }
  }

  const langInstruction = language !== 'ko'
    ? `Generate content in ${language === 'en' ? 'English' : language === 'ja' ? 'Japanese' : language}.`
    : ''

  const userPrompt = `제품명: "${productName}"
카테고리: ${category}
기존 훅: ${existingHook || '없음'}
${langInstruction}

이 제품의 클릭율을 극대화하는 5가지 최적화 훅을 생성하고, 최적 CTA와 긴급성 요소를 제안하세요.`

  return generateJSON<ClickOptResult>(SYSTEM_PROMPT, userPrompt)
}

export async function applyClickOptimization(contentId: number, productName: string, category: string): Promise<void> {
  const rows = await query<{ id: number; hook: string; platform: string }>(
    'SELECT id, hook, platform FROM content WHERE id = ?',
    [contentId]
  )
  if (!rows.length) return

  const result = await runClickAgent(productName, category, rows[0].hook)
  const bestHook = result.optimized_hooks[0]?.hook || rows[0].hook

  await execute(
    `UPDATE content SET hook = ?, updated_at = datetime('now') WHERE id = ?`,
    [bestHook, contentId]
  )
}
