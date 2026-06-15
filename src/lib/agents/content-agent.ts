import { execute } from '@/lib/db'
import { USE_MOCK, mockDelay, generateJSON } from '@/lib/claude-client'

const PLATFORMS = ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Threads', 'Naver'] as const

const SYSTEM_PROMPT = `당신은 한국 쇼핑숏츠 전문 콘텐츠 크리에이터입니다.

핵심 원칙:
1. 첫 3초 훅: 시청자를 즉시 멈추게 하는 강력한 훅 (의문문/충격/공감 활용)
2. 30초 스크립트: 문제 제기 → 제품 해결 → 구매 CTA 구조
3. 각 플랫폼 특성에 맞는 최적화 필수

플랫폼별 스크립트 규칙:
- YouTube: 제목형 훅 + "링크 설명란에" CTA + 좋아요/구독 유도
- Instagram: 감성적 + 프로필 링크 언급 + 해시태그 5~10개
- TikTok: 짧고 임팩트 + "바이오 링크" + 트렌디한 말투
- Facebook: 친근 말투 + 댓글 링크 + 공유 유도
- Threads: 솔직한 리뷰 톤 + 짧은 텍스트
- Naver: 정보성 + 검색 키워드 포함

중요: 6개 플랫폼의 hook은 모두 다른 문구여야 함. 같은 훅 반복 금지.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "contents": [
    {
      "platform": "YouTube",
      "hook": "첫 3초 훅 (30자 이내)",
      "script": "30초 전체 스크립트 (200자 내외)",
      "image_prompt": "AI 이미지 생성용 영어 프롬프트"
    }
  ]
}`

interface ContentItem {
  platform: string
  hook: string
  script: string
  image_prompt: string
}

interface ContentBatch {
  contents: ContentItem[]
}

function buildMockContents(productName: string) {
  const hooks = [
    `${productName} 이거 진짜야?? 댓글 폭발`,
    `이 제품 나만 몰랐나`,
    `30초 안에 설명하는 ${productName}`,
    `품절 전에 빠르게 봐`,
    `엄마가 사줬는데 진짜 미쳤다`,
    `${productName} 솔직 후기`,
  ]
  const base = `${productName}인데요, 요즘 핫한 아이템이에요. 가격도 착하고 퀄리티는 최상입니다.`
  const scripts: Record<string, string> = {
    YouTube: `${base}\n📌 링크 설명란에서 구매하세요!\n👍 좋아요와 구독 부탁드려요`,
    Instagram: `${base}\n👆 프로필 링크에서 구매 가능\n#쇼핑추천 #핫템 #쿠팡`,
    TikTok: `${base}\n바이오 링크에 있어요!\n#쇼핑하울 #핫템 #쿠팡`,
    Facebook: `${base}\n👇 댓글에 구매 링크 있어요! 공유해주세요 🙏`,
    Threads: `${base}\n프로필 링크에서 확인하세요`,
    Naver: `${base}\n블로그 링크에서 쿠팡 최저가 확인하세요 ✅`,
  }
  return PLATFORMS.map((platform, i) => ({
    platform,
    hook: hooks[i],
    script: scripts[platform],
    image_prompt: `Clean white background product photography of ${productName}, Korean e-commerce style, professional lighting`,
  }))
}

export async function runContentAgent(
  productId: number,
  productName: string,
  category: string,
  price?: number
) {
  if (USE_MOCK) {
    await mockDelay()
    const contents = buildMockContents(productName)
    for (const c of contents) {
      await execute(
        'INSERT INTO content (product_id, platform, hook, script, image_prompt, status) VALUES (?, ?, ?, ?, ?, ?)',
        [productId, c.platform, c.hook, c.script, c.image_prompt, 'draft']
      )
    }
    return {
      text: `## ${productName} 콘텐츠 생성 완료 (Mock)\n\n6개 플랫폼 콘텐츠 준비됐습니다.`,
      toolCalls: ['save_content_batch (mock)'],
    }
  }

  const priceStr = price ? `, 가격: ${price.toLocaleString()}원` : ''
  const userPrompt = `제품명: "${productName}"
카테고리: ${category}${priceStr}

위 제품으로 YouTube, Instagram, TikTok, Facebook, Threads, Naver 6개 플랫폼 쇼핑숏츠 콘텐츠를 생성해주세요.
각 플랫폼의 hook은 반드시 다른 문구로, 각 플랫폼 특성에 맞게 작성하세요.`

  const batch = await generateJSON<ContentBatch>(SYSTEM_PROMPT, userPrompt)

  const savedIds: number[] = []
  for (const c of batch.contents) {
    const { lastInsertRowid } = await execute(
      'INSERT INTO content (product_id, platform, hook, script, image_prompt, status) VALUES (?, ?, ?, ?, ?, ?)',
      [productId, c.platform, c.hook, c.script, c.image_prompt, 'draft']
    )
    savedIds.push(lastInsertRowid)
  }

  return {
    text: `## ${productName} 콘텐츠 생성 완료\n\n${batch.contents.length}개 플랫폼 콘텐츠 저장됨 (IDs: ${savedIds.join(', ')})`,
    toolCalls: [`save_content_batch(product_id=${productId}, count=${batch.contents.length})`],
  }
}
