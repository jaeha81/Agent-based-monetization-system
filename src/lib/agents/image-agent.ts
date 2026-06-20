const STABILITY_API = 'https://api.stability.ai/v2beta/stable-image/generate/sd3'

// 카테고리별 Unsplash 검색 키워드 (API 키 없이 사용 가능한 공개 이미지)
const CATEGORY_KEYWORDS: Record<string, string> = {
  '전자': 'electronics,gadget,technology',
  '주방': 'kitchen,cooking,appliance',
  '뷰티': 'beauty,cosmetics,skincare',
  '패션': 'fashion,clothing,accessory',
  '식품': 'food,organic,package',
  '생활': 'home,lifestyle,household',
  '스포츠': 'sports,fitness,exercise',
  '유아': 'baby,children,toy',
  '다이소': 'stationery,household,utility',
}

export function buildProductImagePrompt(productName: string, category: string): string {
  const categoryMap: Record<string, string> = {
    '전자': 'electronic gadget, tech product',
    '주방': 'kitchen appliance, cookware',
    '뷰티': 'beauty product, cosmetics, skincare',
    '패션': 'fashion accessory, clothing',
    '식품': 'food product, packaged food',
    '생활': 'household item, daily goods',
    '스포츠': 'sports equipment, fitness gear',
    '유아': 'baby product, children toy',
  }
  const categoryHint = Object.entries(categoryMap).find(([k]) => category.includes(k))?.[1] || 'consumer product'
  return `${productName}, ${categoryHint}, professional product photography, white background, studio lighting, sharp focus, high resolution, commercial photography, no text, no watermark, clean minimal style`
}

// 카테고리 기반 Unsplash 이미지 URL (API 키 불필요 — 폴백용)
export function buildFallbackImageUrl(productName: string, category: string): string {
  const keywords = Object.entries(CATEGORY_KEYWORDS).find(([k]) => category.includes(k))?.[1]
    || encodeURIComponent(productName.slice(0, 20))
  // Unsplash source URL (공개 무료, 1080x1920 세로)
  return `https://source.unsplash.com/1080x1920/?${keywords}`
}

// Stability AI SD3로 제품 이미지 생성, URL 반환 (실패 시 Unsplash URL 폴백)
export async function generateProductImage(
  imagePrompt: string,
  category: string = '일반',
  productName: string = '',
): Promise<string | null> {
  const apiKey = process.env.STABILITY_API_KEY?.replace(/^﻿/, '').trim()

  // API 키 없으면 바로 Unsplash 폴백
  if (!apiKey) {
    const url = buildFallbackImageUrl(productName, category)
    console.log('[ImageAgent] STABILITY_API_KEY 미설정 → Unsplash 이미지 사용:', url)
    return url
  }

  try {
    const form = new FormData()
    form.append('prompt', imagePrompt.slice(0, 10000))
    form.append('output_format', 'jpeg')
    form.append('aspect_ratio', '9:16')

    const res = await fetch(STABILITY_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'image/*',
      },
      body: form,
    })

    if (!res.ok) {
      const errText = await res.text()
      console.warn('[ImageAgent] Stability AI 실패, Unsplash 폴백:', res.status, errText.slice(0, 100))
      return buildFallbackImageUrl(productName, category)
    }

    const arrayBuf = await res.arrayBuffer()
    const base64 = Buffer.from(arrayBuf).toString('base64')
    return `data:image/jpeg;base64,${base64}`
  } catch (err) {
    console.warn('[ImageAgent] 이미지 생성 오류, Unsplash 폴백:', err instanceof Error ? err.message : String(err))
    return buildFallbackImageUrl(productName, category)
  }
}
