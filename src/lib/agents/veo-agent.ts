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
      `고품질 한국 이커머스 쇼츠 광고 영상, 정확히 8초, 세로형 9:16 비율. ` +
      `[씬1 0-2초] ${scenario.hook} — 극적 제품 reveal 클로즈업, 반짝이는 하이라이트 조명. ` +
      `[씬2 2-5초] 제품 "${productName}" 360도 회전 쇼케이스, ${points}, 슬로우모션 질감 강조. ` +
      `[씬3 5-7초] ${scenario.priceText} — 가격 강조 컷, 미니멀 배경에 제품 단독 클로즈업. ` +
      `[씬4 7-8초] 강렬한 CTA: ${scenario.cta} — 카메라 줌인 엔딩. ` +
      `전문 광고 촬영 스타일, 시네마틱 색감 보정, 밝고 청결한 스튜디오, ` +
      `화이트/그라디언트 배경, 텍스트 없음, 4K 선명도`
    )
  }
  if (language === 'ja') {
    return (
      `高品質Eコマースショートムービー 8秒 縦型9:16. ` +
      `[Scene1 0-2s] ${scenario.hook} — ドラマチックな製品クローズアップ reveal. ` +
      `[Scene2 2-5s] "${productName}" 360度ショーケース、${points}、スローモーション質感強調. ` +
      `[Scene3 5-7s] ${scenario.priceText} — ミニマル背景でシングル製品フォーカス. ` +
      `[Scene4 7-8s] CTA: ${scenario.cta} — ズームインエンディング. ` +
      `プロ広告スタイル、シネマティック色調、明るいスタジオ、テキストなし`
    )
  }
  return (
    `High-quality e-commerce shorts ad video, exactly 8 seconds, vertical 9:16. ` +
    `[Scene1 0-2s] ${scenario.hook} — dramatic product reveal close-up, sparkling highlights. ` +
    `[Scene2 2-5s] "${productName}" 360-degree showcase, ${points}, slow-motion texture emphasis. ` +
    `[Scene3 5-7s] ${scenario.priceText} — price hero shot, product isolated on minimal background. ` +
    `[Scene4 7-8s] Strong CTA: ${scenario.cta} — camera zoom-in ending. ` +
    `Professional commercial photography style, cinematic color grading, ` +
    `bright clean studio, white or gradient background, no text overlay, 4K clarity`
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
