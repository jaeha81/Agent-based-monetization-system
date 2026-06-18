import { execute } from '@/lib/db'
import { USE_MOCK, mockDelay, generateJSON } from '@/lib/claude-client'
import { getAffiliateDisclosure } from '@/lib/markets'

const PROHIBITED_CATEGORIES = ['건강', '의료', '투자', '금융', '성인', '불법', 'health', 'medical', 'investment', 'adult', 'illegal']

const PROHIBITED_EXPRESSIONS_KO = [
  '직접 써봤', '써봤는데', '실제로 사용해봤', '제가 써봤', '나만 아는',
  '효과 보장', '완치', '100% 효과', '부작용 없음', '과학적으로 증명',
]

const PLATFORMS_BY_MARKET: Record<string, string[]> = {
  KR: ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Threads', 'Naver'],
  US: ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Pinterest', 'Twitter'],
  JP: ['YouTube', 'Instagram', 'TikTok', 'Twitter', 'LINE', 'Facebook'],
  default: ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Threads', 'Pinterest'],
}

function buildSystemPrompt(language: string): string {
  if (language === 'en') {
    return `You are an expert e-commerce shorts content creator for global English-speaking audiences.

Click-Maximizing Principles:
1. Hook (0-3s): Use psychological triggers — scarcity, curiosity gap, price anchoring, social proof
2. Problem (3-10s): Agitate the pain point
3. Solution (10-25s): Position product as THE answer with specific benefits
4. CTA (25-30s): Clear urgency-driven action ("Buy NOW - limited stock")

Psychological Triggers to Use:
- Scarcity: "Only X left in stock", "Limited time deal"
- Social proof: "4.9★ with 10K+ reviews"
- Curiosity gap: "I had NO idea this existed until..."
- Price anchor: "Retails for $80 → yours for $25 today"
- FOMO: "Everyone's buying this and here's why"

Platform Rules:
- YouTube: SEO title hook + "link in description" + like/subscribe
- Instagram: Emotional + "link in bio" + 8-10 hashtags #ad
- TikTok: Punchy + "bio link" + trending sounds reference
- Facebook: Conversational + share prompt + comment link
- Pinterest: Descriptive + seasonal + benefit keywords
- Twitter: Concise + trending hashtag + affiliate link

[Compliance] NEVER use first-person experience claims ("I used this", "I tried it", "personally tested"). Use third-person social proof or product specs only.
REQUIRED: Include #ad in Instagram/Pinterest. Include "affiliate link" in YouTube description.
All 6 hooks MUST be different. No repetition.

Respond ONLY in JSON:
{
  "contents": [
    { "platform": "YouTube", "hook": "hook under 60 chars", "script": "30s script ~200 chars", "image_prompt": "English AI image prompt" }
  ]
}`
  }

  if (language === 'ja') {
    return `あなたは日本市場向けのeコマースショート動画の専門コンテンツクリエイターです。

クリック最大化の原則:
1. フック（0-3秒）：希少性、好奇心ギャップ、価格アンカリング、社会的証明
2. 問題提起（3-10秒）：悩みを強調
3. 解決策（10-25秒）：具体的なメリットで商品をアピール
4. CTA（25-30秒）：緊急性のある行動喚起

プラットフォームルール：
- YouTube: SEOタイトルフック + 「概要欄リンク」
- Instagram: 感情訴求 + 「プロフリンク」 + ハッシュタグ #PR
- TikTok: 短くインパクト + 「プロフリンク」
- Twitter: 簡潔 + トレンドハッシュタグ
- LINE: 親近感 + 簡潔なCTA
- Facebook: 親しみやすいトーン + コメントリンク

【コンプライアンス】実体験を装う表現禁止：「実際に使ってみた」「私が試した」等は使用不可。
注意：広告であることの明示が必要（#PR #広告 #アフィリエイト）
6つのフックは必ず異なる文句にすること。

JSON形式のみで回答：
{
  "contents": [
    { "platform": "YouTube", "hook": "フック60字以内", "script": "30秒スクリプト200字", "image_prompt": "English AI image prompt" }
  ]
}`
  }

  // Korean (default)
  return `당신은 한국 쇼핑숏츠 전문 콘텐츠 크리에이터이자 클릭율 최적화 전문가입니다.

[컴플라이언스 필수] 절대 사용 금지 표현 (표시광고법 위반):
- "직접 써봤다", "써봤는데", "실제로 사용해봤어요", "나만 아는 꿀팁"
- "효과 보장", "완치", "100% 효과", "부작용 없음"
- 실제 체험을 암시하는 모든 1인칭 표현
위 표현이 포함되면 생성을 거부하고 대체 문구를 사용하세요.

클릭 극대화 원칙:
1. 훅 (0-3초): 심리적 트리거 필수 사용
   - 희소성: "재고 소진 전", "오늘만 이 가격"
   - 호기심 갭: "이거 모르면 손해", "충격 실화"
   - 가격 앵커링: "정가 5만원 → 지금 2만원"
   - 사회적 증명: "리뷰 4.9점 구매자 2만명"
2. 공감 (3-10초): 타겟 문제 자극
3. 해결 (10-25초): 제품이 왜 최고인지 구체적 혜택 중심
4. CTA (25-30초): 긴급성 + 명확한 행동 촉구

플랫폼별 규칙:
- YouTube: SEO 제목형 훅 + "설명란 링크" + 좋아요/구독 유도
- Instagram: 감성 + "프로필 링크" + 해시태그 8-10개 + #광고 표시
- TikTok: 짧고 강렬 + "바이오 링크" + 트렌디 말투
- Facebook: 친근 + 댓글 링크 + 공유 유도
- Threads: 솔직한 리뷰 톤 + 짧은 텍스트
- Naver: 검색 키워드 포함 + 정보성 + 블로그 링크

중요: 6개 플랫폼 훅은 반드시 모두 다른 심리 기법 사용. 같은 훅 절대 금지.
쿠팡 파트너스 수수료 고지 문구 script에 포함 필수.

반드시 JSON 형식으로만 응답:
{
  "contents": [
    { "platform": "YouTube", "hook": "훅 (40자 이내)", "script": "30초 스크립트 (200자 내외)", "image_prompt": "AI 이미지 영어 프롬프트" }
  ]
}`
}

interface ContentItem {
  platform: string
  hook: string
  script: string
  image_prompt: string
}

interface ContentBatch {
  contents: ContentItem[]
}

function buildMockContents(productName: string, language: string) {
  const hooks: Record<string, string[]> = {
    ko: [
      `${productName} 이거 진짜야?? 댓글 폭발`,
      `재고 소진 전에 빨리 봐 (정가 5만원 → 지금 2만원)`,
      `리뷰 4.9점 2만명이 산 ${productName}`,
      `이거 모르면 진짜 손해 (충격 실화)`,
      `오늘만 이 가격 ${productName} 실화냐`,
      `${productName} 솔직 후기 (구매자 2만명 인증)`,
    ],
    en: [
      `This ${productName} changed my life and I'm NOT joking`,
      `$80 retailer vs $25 on Amazon (you won't believe the diff)`,
      `POV: You just discovered the best ${productName} deal ever`,
      `10K people bought this and HERE'S WHY`,
      `I tested 5 ${productName}s so you don't have to`,
      `The ${productName} everyone's talking about right now`,
    ],
    ja: [
      `${productName}がヤバすぎて紹介せずにいられない`,
      `定価5000円→今だけ2000円の${productName}`,
      `レビュー4.9点の${productName}を正直レビュー`,
      `これを知らないと損する${productName}の秘密`,
      `${productName}が在庫切れ寸前！急いで`,
      `みんなが買っている${productName}を試してみた`,
    ],
  }

  const selectedHooks = hooks[language] || hooks['en']
  const platforms = PLATFORMS_BY_MARKET['KR']

  return platforms.map((platform, i) => ({
    platform,
    hook: selectedHooks[i] || selectedHooks[0],
    script: `${productName} 완전 꿀템이에요! 가격 대비 퀄리티 최상. 지금 설명란 링크에서 확인하세요!`,
    image_prompt: `Clean product photography of ${productName}, white background, professional studio lighting, Korean e-commerce style`,
  }))
}

export async function runContentAgent(
  productId: number,
  productName: string,
  category: string,
  price?: number,
  targetMarket: string = 'KR',
  language: string = 'ko',
) {
  if (PROHIBITED_CATEGORIES.some(c => category.toLowerCase().includes(c.toLowerCase()))) {
    throw new Error(`[Compliance CNT-01] 금지 카테고리입니다: ${category}. 건강/의료/투자/금융/성인/불법 카테고리는 콘텐츠 생성이 제한됩니다.`)
  }

  const platforms = PLATFORMS_BY_MARKET[targetMarket] || PLATFORMS_BY_MARKET['default']

  if (USE_MOCK) {
    await mockDelay()
    const contents = buildMockContents(productName, language)
    const ids: number[] = []
    for (const c of contents) {
      const { lastInsertRowid } = await execute(
        'INSERT INTO content (product_id, platform, hook, script, image_prompt, status, target_market, language, ab_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [productId, c.platform, c.hook, c.script, c.image_prompt, 'draft', targetMarket, language, 'A']
      )
      ids.push(lastInsertRowid)
    }
    return { text: `## ${productName} 콘텐츠 생성 완료 (Mock)\n\n${platforms.length}개 플랫폼 완료`, toolCalls: ['save_content_batch (mock)'] }
  }

  const disclosure = getAffiliateDisclosure(language)
  const priceStr = price ? `, 가격: ${price.toLocaleString()}원` : ''
  const userPrompt = language === 'ko'
    ? `제품명: "${productName}"
카테고리: ${category}${priceStr}

${platforms.join(', ')} 6개 플랫폼용 클릭율 극대화 쇼핑숏츠 콘텐츠를 생성하세요.
각 훅은 반드시 서로 다른 심리 기법을 사용해야 합니다.`
    : `Product: "${productName}"
Category: ${category}${priceStr}
Target market: ${targetMarket}

Create click-maximizing shopping shorts content for ${platforms.join(', ')}.
Each hook must use a different psychological trigger.
Disclosure to include: ${disclosure}`

  const batch = await generateJSON<ContentBatch>(buildSystemPrompt(language), userPrompt)

  for (const c of batch.contents) {
    const combined = `${c.hook} ${c.script}`
    const found = PROHIBITED_EXPRESSIONS_KO.find(expr => combined.includes(expr))
    if (found) {
      throw new Error(`[Compliance CNT-01] 금지 표현 감지됨: "${found}" — 재생성이 필요합니다.`)
    }
  }

  const savedIds: number[] = []
  for (const c of batch.contents) {
    const { lastInsertRowid } = await execute(
      'INSERT INTO content (product_id, platform, hook, script, image_prompt, status, target_market, language, ab_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [productId, c.platform, c.hook, c.script, c.image_prompt, 'draft', targetMarket, language, 'A']
    )
    savedIds.push(lastInsertRowid)
  }

  return {
    text: `## ${productName} 콘텐츠 생성 완료\n\n${batch.contents.length}개 플랫폼 콘텐츠 저장됨 (IDs: ${savedIds.join(', ')})`,
    toolCalls: [`save_content_batch(product_id=${productId}, count=${batch.contents.length}, market=${targetMarket})`],
  }
}
