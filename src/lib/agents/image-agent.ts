const STABILITY_API = 'https://api.stability.ai/v2beta/stable-image/generate/sd3'
const SHOTSTACK_INGEST = 'https://api.shotstack.io/ingest'

// Shotstack STAGE 파악 (shotstack.ts와 동일 로직)
const getShotstackStage = () =>
  process.env.SHOTSTACK_STAGE === 'v1' ? 'v1' : 'stage'

const getShotstackKey = () =>
  process.env.SHOTSTACK_API_KEY?.replace(/^﻿/, '').trim()

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

// binary → Shotstack Ingest API → HTTPS CDN URL
// 실패 시 null 반환
async function uploadToShotstack(arrayBuf: ArrayBuffer): Promise<string | null> {
  const key = getShotstackKey()
  const stage = getShotstackStage()
  if (!key) return null

  try {
    const form = new FormData()
    form.append('file', new Blob([arrayBuf], { type: 'image/jpeg' }), 'product.jpg')

    const uploadRes = await fetch(`${SHOTSTACK_INGEST}/${stage}/sources`, {
      method: 'POST',
      headers: { 'x-api-key': key },
      body: form,
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      console.warn('[ImageAgent] Shotstack Ingest 업로드 실패:', uploadRes.status, errText.slice(0, 120))
      return null
    }

    const uploadJson = await uploadRes.json() as { data?: { id?: string } }
    const sourceId = uploadJson?.data?.id
    if (!sourceId) {
      console.warn('[ImageAgent] Shotstack Ingest: source ID 없음')
      return null
    }

    // 최대 20초 폴링 (2s × 10회)
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const pollRes = await fetch(`${SHOTSTACK_INGEST}/${stage}/sources/${sourceId}`, {
        headers: { 'x-api-key': key },
      })
      if (!pollRes.ok) continue

      const pollJson = await pollRes.json() as { data?: { attributes?: { status?: string; url?: string } } }
      const attrs = pollJson?.data?.attributes
      if (attrs?.status === 'ready' && attrs?.url) {
        console.log('[ImageAgent] Shotstack Ingest 완료:', attrs.url)
        return attrs.url
      }
      if (attrs?.status === 'failed') {
        console.warn('[ImageAgent] Shotstack Ingest 처리 실패')
        return null
      }
    }

    console.warn('[ImageAgent] Shotstack Ingest 타임아웃 (20s)')
    return null
  } catch (err) {
    console.warn('[ImageAgent] Shotstack Ingest 오류:', err instanceof Error ? err.message : String(err))
    return null
  }
}

// Stability AI SD3로 제품 이미지 생성 → Shotstack Ingest로 호스팅 → HTTPS URL 반환.
// 키 미설정·실패·오류 시 null 반환 → Shotstack은 그라데이션 배경만으로 렌더.
export async function generateProductImage(
  imagePrompt: string,
  _category: string = '일반',
  _productName: string = '',
): Promise<string | null> {
  void _category
  void _productName
  const apiKey = process.env.STABILITY_API_KEY?.replace(/^﻿/, '').trim()

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
    console.log('[ImageAgent] Stability AI 이미지 생성 완료, Shotstack Ingest 업로드 중...')

    // Shotstack Ingest로 HTTPS URL 획득
    const hostedUrl = await uploadToShotstack(arrayBuf)
    if (hostedUrl) return hostedUrl

    // Ingest 실패 시 null (그라데이션 폴백 — data URI 반환하지 않음)
    console.warn('[ImageAgent] Ingest 실패 → 이미지 없이 그라데이션 배경 사용')
    return null
  } catch (err) {
    console.warn('[ImageAgent] 이미지 생성 오류 → 그라데이션 배경 사용:', err instanceof Error ? err.message : String(err))
    return null
  }
}
