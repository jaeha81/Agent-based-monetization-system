const STABILITY_API = 'https://api.stability.ai/v2beta/stable-image/generate/sd3'

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

// Stability AI SD3로 제품 이미지 생성 → data URI(base64) 반환.
// 키 미설정·실패·오류 시 null 반환 → Shotstack은 이미지 오버레이 없이 그라데이션
// 배경만으로 렌더(항상 성공). 구 폴백 source.unsplash.com 은 2024년 서비스 종료로
// "Asset URL not downloadable" 렌더 실패를 유발해 제거함.
export async function generateProductImage(
  imagePrompt: string,
  _category: string = '일반',
  _productName: string = '',
): Promise<string | null> {
  const apiKey = process.env.STABILITY_API_KEY?.replace(/^﻿/, '').trim()

  // API 키 없으면 이미지 없이 진행 (그라데이션 배경 폴백)
  if (!apiKey) {
    console.log('[ImageAgent] STABILITY_API_KEY 미설정 → 이미지 없이 그라데이션 배경 사용')
    return null
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
      console.warn('[ImageAgent] Stability AI 실패 → 그라데이션 배경 사용:', res.status, errText.slice(0, 100))
      return null
    }

    const arrayBuf = await res.arrayBuffer()
    const base64 = Buffer.from(arrayBuf).toString('base64')
    return `data:image/jpeg;base64,${base64}`
  } catch (err) {
    console.warn('[ImageAgent] 이미지 생성 오류 → 그라데이션 배경 사용:', err instanceof Error ? err.message : String(err))
    return null
  }
}
