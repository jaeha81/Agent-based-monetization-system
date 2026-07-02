import { generateJSON, USE_MOCK, mockDelay } from '@/lib/claude-client'

export interface SceneDefinition {
  duration: number      // 씬 길이 (초)
  veoPrompt: string     // 씬별 Veo 영어 프롬프트
  ttsText: string       // 씬별 나레이션 텍스트
  visualStyle: string   // 시각 스타일 힌트
}

export interface VideoScenario {
  hook: string              // 25자 이내 심리적 훅
  performancePoints: string[] // 핵심 성능 포인트 3개 (각 35자 이내)
  originalPrice: string     // "정가 XX원" 또는 빈 문자열
  salePrice: string         // "지금 XX원" 또는 빈 문자열
  priceText: string         // 가격 강조 문구
  cta: string               // 20자 이내 CTA
  ttsScript: string         // 30초 TTS 나레이션 (200-250자)
  imagePrompt: string       // 이미지 생성용 영어 프롬프트
  scenes: SceneDefinition[] // 씬별 Veo 프롬프트 (3~4 씬)
  youtubeDescription: string // YouTube 설명란 (링크 포함)
  pinnedComment: string      // 고정 댓글 (링크)
}

// 카테고리별 톤 가이드
const CATEGORY_TONE: Record<string, string> = {
  '생활용품': '유머러스하고 공감가는 — "이거 없으면 하루가 불편해" 스타일',
  '뷰티': '감성적이고 트렌디한 — "요즘 안 쓰는 사람 없다는" 스타일',
  '주방': '실용적이고 유쾌한 — "주방 효율 200% 올려준다는" 스타일',
  '육아': '따뜻하고 신뢰감 있는 — "엄마들 사이에서 난리난" 스타일',
  'IT': '테크 느낌의 흥분된 — "이거 실화냐, 진짜 대박" 스타일',
  '패션': '트렌디하고 감각적인 — "요즘 핫한 코디 필수템" 스타일',
  '식품': '맛있는 상상 자극 — "먹어본 사람만 아는 그 맛" 스타일',
}

const SYSTEM_PROMPT_KO = `당신은 쿠팡 파트너스 상품 쇼츠 영상 시나리오 전문가입니다.
벤치마크: @everyday-c 채널 스타일 — 친근한 친구가 "이거 진짜 좋더라" 추천하는 느낌.

[4씬 구조 — AI 영상(Veo) 생성 최적화]
씬1 (0-8초): 훅 — "요즘 안 쓰는 사람 없다는 이것!" 공감형 도입부
씬2 (8-16초): 제품 클로즈업 — 제품을 극적으로 부각, 360도 회전 또는 드라마틱 등장
씬3 (16-24초): 핵심 기능 3가지 빠르게 — 사용 장면 상상 자극
씬4 (24-30초): 가격+CTA — "설명란 링크에서 바로 확인!"

[필드 규칙]
- hook: 25자 이내, 공감형 심리 트리거 (예: "이거 모르면 손해", "요즘 다들 쓴다는")
- performancePoints: 정확히 3개, 각 35자 이내, 생생한 혜택 중심
- originalPrice/salePrice: 추정 가능 시 작성, 불가 시 빈 문자열
- priceText: "쿠팡 최저가" 또는 할인률
- cta: 20자 이내, 설명란 링크 유도
- ttsScript: 200-250자, 빠르고 캐주얼한 구어체 ("~에요", "~죠", "~거든요")
- imagePrompt: 영어, 마블/흰색 테이블 위 제품 클로즈업 스타일
- scenes: 4개 씬 배열, 각각 Veo 영어 프롬프트 포함
- youtubeDescription: 훅+링크+해시태그 포함 설명란 (AFFILIATE_URL 플레이스홀더 사용)
- pinnedComment: 링크 고정 댓글 (AFFILIATE_URL 플레이스홀더 사용)

[컴플라이언스 — 절대 금지]
- "직접 써봤다", "효과 보장", "100% 효과", "부작용 없음" 등 체험형/과장 표현
- ttsScript에 "광고", "협찬", "파트너스" 언급 금지 (설명란 별도 공시)

JSON 형식으로만 응답.`

const SYSTEM_PROMPT_EN = `You are a product shorts video scenario specialist for Korean shopping content.
Style: friendly influencer recommending products like @everyday-c channel.

[4-Scene Structure for AI video (Veo)]
Scene1 (0-8s): Hook — relatable problem or "everyone's using this now"
Scene2 (8-16s): Product hero shot — dramatic reveal, close-up
Scene3 (16-24s): 3 key features fast — lifestyle context
Scene4 (24-30s): Price + CTA — "link in description"

Output JSON with: hook(max 25 chars), performancePoints(3 items, max 40 chars each),
originalPrice, salePrice, priceText, cta(max 20 chars), ttsScript(200-250 chars English casual),
imagePrompt(English, marble table product closeup style),
scenes(4 items with duration/veoPrompt/ttsText/visualStyle),
youtubeDescription(with AFFILIATE_URL placeholder), pinnedComment(with AFFILIATE_URL placeholder).

[Compliance] NEVER use first-person experience claims or guarantee statements.`

export async function generateVideoScenario(
  productName: string,
  category: string,
  price?: number,
  language: string = 'ko',
  existingHook?: string,
  existingScript?: string,
  affiliateUrl?: string,
): Promise<VideoScenario> {
  if (USE_MOCK) {
    await mockDelay(500)
    return buildMockScenario(productName, existingHook, affiliateUrl)
  }

  const systemPrompt = language === 'ko' ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN
  const toneTip = CATEGORY_TONE[category] || CATEGORY_TONE['생활용품']
  const priceStr = price ? `가격: ${price.toLocaleString()}원` : '(가격 미상 — 카테고리 평균으로 추정 가능)'
  const userPrompt = language === 'ko'
    ? `제품명: "${productName}"
카테고리: ${category}
톤 가이드: ${toneTip}
${priceStr}
${existingHook ? `참고 훅: "${existingHook}"` : ''}
${existingScript ? `참고 스크립트: "${existingScript.slice(0, 200)}"` : ''}

위 제품의 AI 쇼츠 영상 시나리오를 JSON으로 생성하세요.
scenes 배열의 veoPrompt는 영어로, 마블 테이블/스튜디오 배경 제품 클로즈업 스타일로 작성.
youtubeDescription과 pinnedComment의 링크 부분은 AFFILIATE_URL 텍스트로 표시.`
    : `Product: "${productName}", Category: ${category}${price ? `, Price: ₩${price.toLocaleString()}` : ''}
${existingHook ? `Reference hook: "${existingHook}"` : ''}
Generate a 30-second AI shopping shorts scenario in JSON.
scenes[].veoPrompt: English, marble/studio background product closeup style.
Use AFFILIATE_URL as placeholder in youtubeDescription and pinnedComment.`

  try {
    const scenario = await generateJSON<VideoScenario>(systemPrompt, userPrompt)
    if (!Array.isArray(scenario.performancePoints) || scenario.performancePoints.length === 0) {
      scenario.performancePoints = buildMockScenario(productName).performancePoints
    }
    if (!Array.isArray(scenario.scenes) || scenario.scenes.length === 0) {
      scenario.scenes = buildMockScenes(productName)
    }
    // 실제 링크로 교체
    const url = affiliateUrl || 'https://www.coupang.com'
    scenario.youtubeDescription = (scenario.youtubeDescription || buildDefaultDescription(scenario, productName, category)).replace(/AFFILIATE_URL/g, url)
    scenario.pinnedComment = (scenario.pinnedComment || `🔥 최저가 링크 → ${url}`).replace(/AFFILIATE_URL/g, url)
    return scenario
  } catch (err) {
    console.warn('[ScenarioAgent] 시나리오 생성 실패, 목업 사용:', err instanceof Error ? err.message : String(err))
    return buildMockScenario(productName, existingHook, affiliateUrl)
  }
}

function buildDefaultDescription(scenario: VideoScenario, productName: string, category: string): string {
  const tags = [`#${productName.replace(/\s/g, '')}`, `#쿠팡추천`, `#${category}`, `#생활꿀팁`, `#다이소`, `#쇼핑하울`]
  return `${scenario.hook}

✅ 지금 최저가 확인 👇
AFFILIATE_URL

⏰ 오늘만 이 가격! 서두르세요

${tags.join(' ')}

※ 이 영상은 쿠팡 파트너스 활동의 일환으로 수수료를 받을 수 있습니다.`
}

function buildMockScenes(productName: string): SceneDefinition[] {
  return [
    {
      duration: 8,
      veoPrompt: `Korean lifestyle, person looking frustrated without ${productName}, relatable everyday problem, 9:16 vertical, warm lighting, cinematic`,
      ttsText: `이거 없으면 하루가 불편해요`,
      visualStyle: 'lifestyle',
    },
    {
      duration: 8,
      veoPrompt: `${productName} dramatic product reveal on white marble table, studio lighting, 360 degree rotation, isolated product hero shot, 9:16 vertical, 4K`,
      ttsText: `짠! 이게 바로 해결책이에요`,
      visualStyle: 'hero',
    },
    {
      duration: 8,
      veoPrompt: `${productName} in use at modern Korean home, satisfying demonstration, dynamic camera movement, bright clean background, 9:16 vertical`,
      ttsText: `쓰면 쓸수록 너무 편하거든요`,
      visualStyle: 'demo',
    },
    {
      duration: 6,
      veoPrompt: `${productName} centered on gradient background, clean product display, price tag visible area, cinematic fade out, 9:16 vertical`,
      ttsText: `설명란 링크에서 바로 확인하세요!`,
      visualStyle: 'cta',
    },
  ]
}

function buildMockScenario(productName: string, existingHook?: string, affiliateUrl?: string): VideoScenario {
  const name = productName.slice(0, 20)
  const url = affiliateUrl || 'https://www.coupang.com'
  const hook = existingHook?.slice(0, 25) || `요즘 다들 쓴다는 ${name}`
  const tags = [`#${name.replace(/\s/g, '')}`, `#쿠팡추천`, `#생활꿀팁`, `#쇼핑하울`]
  return {
    hook,
    performancePoints: [
      `고품질 소재로 내구성 탁월`,
      `사용법 간단, 누구나 OK`,
      `구매자 4.9점 ★ 압도적 호평`,
    ],
    originalPrice: '',
    salePrice: '',
    priceText: '쿠팡 최저가로 만나보세요',
    cta: '설명란 링크 확인!',
    ttsScript: `${hook}! 이거 정말 편하거든요. 고품질 소재로 내구성도 탁월하고, 누구나 쉽게 사용할 수 있어요. 구매자 4.9점의 압도적 만족도! 쿠팡 최저가로 만나보세요. 설명란 링크에서 바로 확인하세요!`,
    imagePrompt: `${productName}, product photography on white marble surface, dramatic studio lighting, Korean e-commerce style, close-up hero shot, no text, no watermark, 9:16 vertical`,
    scenes: buildMockScenes(productName),
    youtubeDescription: `${hook}\n\n✅ 지금 최저가 확인 👇\n${url}\n\n⏰ 오늘만 이 가격!\n\n${tags.join(' ')}\n\n※ 쿠팡 파트너스 활동으로 수수료를 받을 수 있습니다.`,
    pinnedComment: `🔥 최저가 링크 → ${url}`,
  }
}
