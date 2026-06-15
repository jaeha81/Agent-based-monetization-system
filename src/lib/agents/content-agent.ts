import { getDb } from '@/lib/db'

const SYSTEM_PROMPT = `당신은 쇼핑숏츠 콘텐츠 생성 전문 에이전트입니다.
김정민의 전략: 30초 이내 영상 or 이미지 3장으로 최대 수익 창출.`

void SYSTEM_PROMPT

const platforms = ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Threads', 'Naver']

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

export async function runContentAgent(
  productId: number,
  productName: string,
  category: string,
  price?: number
) {
  void price

  const hookResult = await toolHandler('generate_hook_script', {
    product_name: productName,
    category,
  }) as { hook: string; script: string }

  const imageResult = await toolHandler('generate_image_prompts', {
    product_name: productName,
    style: 'lifestyle',
  }) as { prompts: string[] }

  const contents: Array<{ platform: string; hook: string; script: string; image_prompt: string }> = []

  for (const platform of platforms) {
    const adapted = await toolHandler('adapt_for_platform', {
      base_script: hookResult.script,
      platform,
    }) as { platform: string; adapted_script: string }

    contents.push({
      platform,
      hook: hookResult.hook,
      script: adapted.adapted_script,
      image_prompt: imageResult.prompts[0] || '',
    })
  }

  await toolHandler('save_content_batch', { product_id: productId, contents })

  const contentsMap = Object.fromEntries(
    contents.map(c => [c.platform, { hook: c.hook, script: c.script, image_prompt: c.image_prompt }])
  )

  return {
    text: `## ${productName} 콘텐츠 생성 완료\n\n6개 플랫폼 콘텐츠가 준비됐습니다. 각 탭에서 확인하세요.`,
    toolCalls: [
      `generate_hook_script({"product_name":"${productName}","category":"${category}"})`,
      ...platforms.map(p => `adapt_for_platform({"platform":"${p}"})`),
      `generate_image_prompts({"product_name":"${productName}","style":"lifestyle"})`,
      `save_content_batch({"product_id":${productId},"contents":[${contents.length}개]})`,
    ],
    contents: contentsMap,
  }
}
