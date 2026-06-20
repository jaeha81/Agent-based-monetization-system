import type { VideoScenario } from './scenario-agent'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL = 'veo-2.0-generate-001'

const getKey = () => process.env.GEMINI_API_KEY?.replace(/^﻿/, '').trim()

// Veo render_id 식별자 (Shotstack UUID와 구분)
export const VEO_PREFIX = 'veo:'
export const isVeoRender = (renderId: string) => renderId.startsWith(VEO_PREFIX)
export const toVeoOp = (renderId: string) => renderId.slice(VEO_PREFIX.length)

export function buildVeoPrompt(
  scenario: VideoScenario,
  productName: string,
  language: string = 'ko',
): string {
  const points = scenario.performancePoints.slice(0, 2).join(', ')
  if (language === 'ko') {
    return (
      `고품질 상업 광고 영상 8초. 제품명: ${productName}. ` +
      `핵심 메시지: ${scenario.hook}. ` +
      `주요 특징: ${points}. ` +
      `가격 포인트: ${scenario.priceText}. ` +
      `세로형(9:16), 전문 제품 클로즈업, 밝은 스튜디오 조명, ` +
      `다이나믹 카메라 무빙, 상업 광고 스타일, 텍스트 없음, ` +
      `깔끔한 그라디언트 배경, 4K 고해상도`
    )
  }
  if (language === 'ja') {
    return (
      `高品質な商業広告動画 8秒. 製品名: ${productName}. ` +
      `キャッチコピー: ${scenario.hook}. 特長: ${points}. ` +
      `縦型(9:16)、プロの製品クローズアップ、明るいスタジオ照明、` +
      `ダイナミックカメラ、テキストなし、グラデーション背景`
    )
  }
  return (
    `High-quality 8-second commercial video. Product: ${productName}. ` +
    `Hook: ${scenario.hook}. Features: ${points}. Price: ${scenario.priceText}. ` +
    `Vertical 9:16, professional product close-up, bright studio lighting, ` +
    `dynamic camera movement, commercial style, no text overlay, clean gradient background`
  )
}

// ─── 비동기 제출 (LRO 이름 반환) ──────────────────────────────────────────────
export async function submitVeoJob(prompt: string): Promise<string> {
  const key = getKey()
  if (!key) throw new Error('GEMINI_API_KEY 미설정 — Veo 사용 불가')

  const res = await fetch(
    `${BASE}/models/${MODEL}:generateVideo?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${MODEL}`,
        prompt: { text: prompt },
        config: {
          aspectRatio: '9:16',
          durationSec: 8,
          sampleCount: 1,
          enhancePrompt: true,
        },
      }),
    }
  )

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Veo 제출 실패 (${res.status}): ${errText.slice(0, 300)}`)
  }

  const data = await res.json() as { name?: string }
  if (!data.name) throw new Error(`Veo: operation name 없음 — 응답: ${JSON.stringify(data).slice(0, 200)}`)

  console.log(`[VeoAgent] 영상 생성 시작: ${data.name}`)
  return `${VEO_PREFIX}${data.name}`
}

// ─── 단일 폴링 (waiting 잡 체크용) ────────────────────────────────────────────
export async function pollVeoJob(renderId: string): Promise<{
  status: 'pending' | 'done' | 'failed'
  videoUri?: string
  error?: string
}> {
  const key = getKey()
  if (!key) throw new Error('GEMINI_API_KEY 미설정')

  const operationName = toVeoOp(renderId)
  const res = await fetch(`${BASE}/${operationName}?key=${key}`)

  if (!res.ok) {
    return { status: 'pending', error: `Poll HTTP ${res.status}` }
  }

  const data = await res.json() as {
    done?: boolean
    response?: {
      generatedVideos?: Array<{ video?: { uri: string; mimeType?: string } }>
    }
    error?: { message: string; code?: number }
  }

  if (data.error) {
    return { status: 'failed', error: `Veo 오류: ${data.error.message}` }
  }

  if (data.done && data.response?.generatedVideos?.[0]?.video?.uri) {
    return {
      status: 'done',
      videoUri: data.response.generatedVideos[0].video!.uri,
    }
  }

  return { status: 'pending' }
}

// ─── 영상 다운로드 (Gemini Files API 인증) ────────────────────────────────────
export async function downloadVeoVideo(uri: string): Promise<Buffer> {
  const key = getKey()
  if (!key) throw new Error('GEMINI_API_KEY 미설정')

  const sep = uri.includes('?') ? '&' : '?'
  const res = await fetch(`${uri}${sep}alt=media&key=${key}`, {
    headers: { Accept: 'video/mp4, video/*' },
  })

  if (!res.ok) {
    throw new Error(`Veo 영상 다운로드 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }

  return Buffer.from(await res.arrayBuffer())
}
