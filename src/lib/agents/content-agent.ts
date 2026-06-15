import Anthropic from '@anthropic-ai/sdk'
import { USE_MOCK, mockDelay, runToolLoop } from '@/lib/claude-client'
import { getDb } from '@/lib/db'

const SYSTEM_PROMPT = `당신은 쇼핑숏츠 콘텐츠 생성 전문 에이전트입니다.
김정민의 전략: 30초 이내 영상 or 이미지 3장으로 최대 수익 창출.

콘텐츠 생성 원칙:
1. 훅(Hook): 첫 3초 안에 시청자를 사로잡을 문장 (의문형/충격형/공감형)
2. 스크립트: 15초 이내 제품 소개 + 구매 유도
3. 이미지 프롬프트: AI 생성 이미지용 영어 프롬프트 (제품 연출)
4. 플랫폼별 최적화: YouTube(긴 설명), TikTok(해시태그 중심), Instagram(DM 유도)
5. CTA(Call to Action): 댓글/링크/DM 유도

항상 한국어 훅+스크립트, 영어 이미지 프롬프트로 제공하세요.`

const platforms = ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Threads', 'Naver']

const tools: Anthropic.Tool[] = [
  {
    name: 'generate_hook_script',
    description: '3초 훅 + 15초 스크립트 생성',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_name: { type: 'string' },
        price: { type: 'number' },
        category: { type: 'string' },
        target_age: { type: 'string', description: '10대|20대|30대|40대|전연령' },
        celebrity: { type: 'string', description: '관련 셀럽/연예인 (선택)' },
      },
      required: ['product_name'],
    },
  },
  {
    name: 'adapt_for_platform',
    description: '플랫폼별 포맷으로 콘텐츠 최적화',
    input_schema: {
      type: 'object' as const,
      properties: {
        base_script: { type: 'string' },
        platform: { type: 'string', enum: platforms },
      },
      required: ['base_script', 'platform'],
    },
  },
  {
    name: 'generate_image_prompts',
    description: 'AI 이미지 생성용 프롬프트 3개 생성',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_name: { type: 'string' },
        style: {
          type: 'string',
          enum: ['product_shot', 'lifestyle', 'comparison', 'unboxing'],
        },
      },
      required: ['product_name'],
    },
  },
  {
    name: 'save_content_batch',
    description: '6개 플랫폼용 콘텐츠를 일괄 DB 저장',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'number' },
        contents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              platform: { type: 'string' },
              hook: { type: 'string' },
              script: { type: 'string' },
              image_prompt: { type: 'string' },
            },
          },
        },
      },
      required: ['product_id', 'contents'],
    },
  },
]

async function toolHandler(name: string, input: Record<string, unknown>): Promise<unknown> {
  const db = getDb()

  if (name === 'generate_hook_script') {
    const { product_name, celebrity } = input as { product_name: string; celebrity?: string }
    const hooks = [
      `${product_name} 이거 진짜야?? 댓글 폭발 중`,
      `${celebrity ? celebrity + ' 이 제품' : '이 제품'} 뭔지 알아? 나만 몰랐나`,
      `30초 안에 설명하는 ${product_name}`,
      `이거 품절 되기 전에 빠르게 봐`,
      `엄마가 이거 사줬는데 진짜 미쳤다`,
    ]
    const hook = hooks[Math.floor(Math.random() * hooks.length)]
    return {
      hook,
      script: `${hook}\n\n${product_name}인데요, ${celebrity ? celebrity + '이 실제로 사용하는' : '요즘 핫한'} 아이템이에요. 가격도 착하고 퀄리티는 최상입니다. 구매 링크는 댓글에 달아놨어요!`,
    }
  }

  if (name === 'adapt_for_platform') {
    const { base_script, platform } = input as { base_script: string; platform: string }
    const adaptations: Record<string, string> = {
      YouTube: `${base_script}\n\n📌 영상 설명란의 쿠팡 링크로 구매하세요!\n👍 좋아요와 구독 부탁드려요`,
      Instagram: `${base_script}\n\n👆 프로필 링크에서 구매 가능\n📩 DM으로 문의환영\n#쇼핑추천 #핫템 #좋은거공유`,
      TikTok: `${base_script}\n\n링크 바이오에 있어요!\n#쇼핑하울 #핫템 #추천 #다이소 #쿠팡`,
      Facebook: `${base_script}\n\n👇 댓글에 구매 링크 달아놨어요!\n공유해서 주변에도 알려주세요 🙏`,
      Threads: `${base_script}\n\n프로필 링크에서 확인하세요`,
      Naver: `${base_script}\n\n블로그 글 링크 확인! 쿠팡 최저가 링크 있어요 ✅`,
    }
    return { platform, adapted_script: adaptations[platform] || base_script }
  }

  if (name === 'generate_image_prompts') {
    const { product_name, style } = input as { product_name: string; style?: string }
    return {
      prompts: [
        `Clean white background product photography of ${product_name}, Korean e-commerce style, high resolution, professional lighting`,
        `Lifestyle shot of ${product_name} being used, natural Korean home setting, warm lighting, aesthetic`,
        `${style === 'comparison' ? 'Before and after comparison showing' : 'Close-up detail shot of'} ${product_name}, crisp and clear, Korean shopping app style`,
      ],
    }
  }

  if (name === 'save_content_batch') {
    const { product_id, contents } = input as {
      product_id: number
      contents: Array<{ platform: string; hook: string; script: string; image_prompt: string }>
    }
    const insert = db.prepare(
      'INSERT INTO content (product_id, platform, hook, script, image_prompt, status) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const ids: number[] = []
    for (const c of contents) {
      const r = insert.run(product_id, c.platform, c.hook, c.script, c.image_prompt, 'draft')
      ids.push(Number(r.lastInsertRowid))
    }
    return { saved: ids.length, content_ids: ids }
  }

  return { error: 'Unknown tool' }
}

const MOCK_CONTENT_BATCH = {
  YouTube: {
    hook: '이거 다이소에서 파는 거 맞아?? 1500원인데 퀄리티가...',
    script: '이거 다이소에서 파는 거 맞아?? 1500원인데 퀄리티가...\n\n다이소 시냅스 클리어 마카인데요, 요즘 유튜버들 사이에서 엄청 핫한 아이템이에요. 색상도 진하고 번지지 않아서 플래너 꾸미기에 최고입니다. 영상 설명란 링크로 구매하세요!\n\n📌 쿠팡 구매 링크: 설명란 확인\n👍 좋아요와 구독 부탁드려요',
    image_prompt: 'Clean white background product photography of Daiso markers set, Korean e-commerce style, high resolution, professional lighting',
  },
  Instagram: {
    hook: '다이소에서 이런 거 팔아?? 리뷰해봤어요',
    script: '다이소에서 이런 거 팔아?? 리뷰해봤어요\n\n1500원짜리 마카인데 진짜 퀄리티 실화입니다 👏 색상이 선명하고 발색도 좋아요.\n\n👆 프로필 링크에서 구매 가능\n📩 DM으로 문의환영\n#다이소 #쇼핑추천 #핫템 #플래너꾸미기',
    image_prompt: 'Aesthetic lifestyle photo of colorful markers arranged neatly, Korean Instagram style, pastel background, flat lay',
  },
  TikTok: {
    hook: '1500원 다이소 마카 퀄 실화?',
    script: '1500원 다이소 마카 퀄 실화?\n\n이거 진짜예요 여러분... 다이소에서 산 1500원 마카인데 색 보세요. 미침.\n\n링크 바이오에 있어요!\n#다이소하울 #쇼핑추천 #핫템 #마카추천 #문구덕후',
    image_prompt: 'Dynamic TikTok style product shot of colorful markers, vibrant colors, trendy Korean aesthetic, close-up detail',
  },
  Facebook: {
    hook: '다이소 마카 써보셨나요? 이거 완전 대박',
    script: '다이소 마카 써보셨나요? 이거 완전 대박\n\n1500원인데 품질이 정말 좋아요! 플래너나 노트 꾸밀 때 딱입니다. 색상도 선명하고 번짐도 없어요.\n\n👇 댓글에 구매 링크 달아놨어요!\n공유해서 주변에도 알려주세요 🙏',
    image_prompt: 'Facebook friendly product image of marker set, bright and clear, Korean shopping style',
  },
  Threads: {
    hook: '다이소 1500원 마카 리뷰',
    script: '다이소 1500원 마카 리뷰\n\n생각보다 훨씬 좋아서 깜짝 놀랐음. 색감 진짜 예쁘고 발색 좋음.\n\n프로필 링크에서 확인하세요',
    image_prompt: 'Simple clean product photo of markers, minimal Korean style',
  },
  Naver: {
    hook: '다이소 마카 1500원 실사용 후기 (쿠팡 링크 포함)',
    script: '다이소 마카 1500원 실사용 후기 (쿠팡 링크 포함)\n\n다이소 시냅스 클리어 마카 실제 사용해봤습니다. 1500원인데 퀄리티가 기대 이상이에요. 색상 선명하고 번짐 없음.\n\n블로그 글 링크 확인! 쿠팡 최저가 링크 있어요 ✅',
    image_prompt: 'Naver blog style review photo of markers, Korean blog aesthetic, detailed product shot',
  },
}

export async function runContentAgent(
  productId: number,
  productName: string,
  category: string,
  price?: number
) {
  if (USE_MOCK) {
    await mockDelay(1500)
    return {
      text: `## ${productName} 콘텐츠 생성 완료\n\n6개 플랫폼 콘텐츠가 준비됐습니다. 각 탭에서 확인하세요.`,
      toolCalls: [
        `generate_hook_script({"product_name":"${productName}","category":"${category}"})`,
        'adapt_for_platform({"platform":"YouTube"})',
        'adapt_for_platform({"platform":"TikTok"})',
        'generate_image_prompts({"product_name":"' + productName + '","style":"lifestyle"})',
        `save_content_batch({"product_id":${productId},"contents":[...]})`,
      ],
      contents: MOCK_CONTENT_BATCH,
    }
  }

  const result = await runToolLoop(
    SYSTEM_PROMPT,
    `다음 제품의 6개 플랫폼(YouTube, Instagram, TikTok, Facebook, Threads, Naver)용 숏츠 콘텐츠를 생성해 주세요:\n\n제품명: ${productName}\n카테고리: ${category}\n가격: ${price ? price.toLocaleString() + '원' : '미입력'}\n\n각 플랫폼별 훅, 스크립트, 이미지 프롬프트를 생성하고 DB에 저장해 주세요.`,
    tools,
    toolHandler
  )

  return { ...result, contents: MOCK_CONTENT_BATCH }
}
