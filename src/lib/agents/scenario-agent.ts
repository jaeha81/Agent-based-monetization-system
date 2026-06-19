import { generateJSON, USE_MOCK, mockDelay } from '@/lib/claude-client'

export interface VideoScenario {
  hook: string              // 25자 이내 심리적 훅
  performancePoints: string[] // 핵심 성능 포인트 3개 (각 35자 이내)
  originalPrice: string     // "정가 XX원" 또는 빈 문자열
  salePrice: string         // "지금 XX원" 또는 빈 문자열
  priceText: string         // 가격 강조 문구
  cta: string               // 20자 이내 CTA
  ttsScript: string         // 30초 TTS 나레이션 (200-250자)
  imagePrompt: string       // 이미지 생성용 영어 프롬프트
}

const SYSTEM_PROMPT_KO = `당신은 30초 쇼핑 숏츠 영상 시나리오 전문가입니다.

[4씬 구조 — 정확히 따를 것]
씬1 (0-7초): 훅 — 심리적 트리거로 시선 강탈
씬2 (7-18초): 성능 포인트 — 3가지 핵심 기능/혜택
씬3 (18-25초): 가격 강조 — 가격 앵커링으로 구매 유도
씬4 (25-30초): CTA — 긴급성 있는 행동 촉구

[필드 규칙]
- hook: 25자 이내, 반드시 심리적 트리거 포함 (희소성/호기심갭/가격앵커링/사회적증명 중 택1)
- performancePoints: 정확히 3개 배열, 각 35자 이내, 구체적 수치/혜택 중심
- originalPrice: "정가 XX,XXX원" 또는 "" (카테고리 평균 추정 가능, 추정 불가 시 빈 문자열)
- salePrice: "지금 XX,XXX원" 또는 "" (originalPrice 있을 때만)
- priceText: 가격 요약 한 줄 (originalPrice 없을 때는 "쿠팡 최저가 확인" 사용)
- cta: 20자 이내, 긴급성 표현
- ttsScript: 200-250자 자연스러운 한국어 나레이션, 4씬 흐름 반영
- imagePrompt: 영어로 Stability AI 이미지 생성 프롬프트 (상품 사진 스타일)

[컴플라이언스 — 절대 금지]
- "직접 써봤다", "효과 보장", "100% 효과", "부작용 없음" 등 체험형/과장 표현
- 쿠팡 파트너스 수수료 수령 사실은 ttsScript에 넣지 않음 (설명란에 별도 공시)

JSON 형식으로만 응답.`

const SYSTEM_PROMPT_EN = `You are a 30-second shopping shorts video scenario specialist.

[4-Scene Structure]
Scene1 (0-7s): Hook — psychological trigger
Scene2 (7-18s): Performance — 3 key benefits
Scene3 (18-25s): Price — price anchoring
Scene4 (25-30s): CTA — urgency-driven action

Output JSON with: hook(max 25 chars), performancePoints(3 items, max 40 chars each),
originalPrice, salePrice, priceText, cta(max 20 chars), ttsScript(200-250 chars English), imagePrompt(English).

[Compliance] NEVER use first-person experience claims or guarantee statements.`

export async function generateVideoScenario(
  productName: string,
  category: string,
  price?: number,
  language: string = 'ko',
  existingHook?: string,
  existingScript?: string,
): Promise<VideoScenario> {
  if (USE_MOCK) {
    await mockDelay(500)
    return buildMockScenario(productName, existingHook)
  }

  const systemPrompt = language === 'ko' ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN
  const priceStr = price ? `가격: ${price.toLocaleString()}원` : '(가격 미상 — 카테고리 평균으로 추정 가능)'
  const userPrompt = language === 'ko'
    ? `제품명: "${productName}"
카테고리: ${category}
${priceStr}
${existingHook ? `참고 훅: "${existingHook}"` : ''}
${existingScript ? `참고 스크립트: "${existingScript.slice(0, 200)}"` : ''}

위 제품의 30초 쇼핑 숏츠 시나리오를 JSON으로 생성하세요.`
    : `Product: "${productName}", Category: ${category}${price ? `, Price: $${price}` : ''}
${existingHook ? `Reference hook: "${existingHook}"` : ''}
Generate a 30-second shopping shorts scenario in JSON.`

  try {
    const scenario = await generateJSON<VideoScenario>(systemPrompt, userPrompt)
    // 성능포인트 정확히 3개 보장
    if (!Array.isArray(scenario.performancePoints) || scenario.performancePoints.length === 0) {
      scenario.performancePoints = buildMockScenario(productName).performancePoints
    }
    return scenario
  } catch (err) {
    console.warn('[ScenarioAgent] 시나리오 생성 실패, 목업 사용:', err instanceof Error ? err.message : String(err))
    return buildMockScenario(productName, existingHook)
  }
}

function buildMockScenario(productName: string, existingHook?: string): VideoScenario {
  const name = productName.slice(0, 20)
  return {
    hook: existingHook?.slice(0, 25) || `${name} 이거 실화냐?`,
    performancePoints: [
      `고품질 소재로 내구성 탁월`,
      `사용법 간단, 누구나 OK`,
      `구매자 4.9점 ★ 압도적 호평`,
    ],
    originalPrice: '',
    salePrice: '',
    priceText: '쿠팡 최저가로 만나보세요',
    cta: '재고 소진 전 확인!',
    ttsScript: `${existingHook || name}! 지금 가장 핫한 아이템입니다. 고품질 소재로 내구성이 탁월하고, 누구나 쉽게 사용할 수 있습니다. 구매자 4.9점의 압도적 만족도를 자랑하는 ${name}. 쿠팡 최저가로 만나보세요. 재고 소진 전에 설명란 링크에서 바로 확인하세요!`,
    imagePrompt: `${productName}, professional product photography, white background, studio lighting, Korean e-commerce, high quality, commercial photography, no text, no watermark`,
  }
}
