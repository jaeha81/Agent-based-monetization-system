import type { VideoScenario, SceneDefinition } from './scenario-agent'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL = 'veo-2.0-generate-001'

const getKey = () => process.env.GEMINI_API_KEY?.replace(/^﻿/, '').trim()

// Veo render_id 식별자 (Shotstack UUID와 구분)
export const VEO_PREFIX = 'veo:'
export const isVeoRender = (renderId: string) => renderId.startsWith(VEO_PREFIX)
export const toVeoOp = (renderId: string) => renderId.slice(VEO_PREFIX.length)

// @everyday-c 스타일 기반 씬별 Veo 프롬프트 생성
export function buildSceneVeoPrompt(
  scene: SceneDefinition,
  productName: string,
): string {
  const base = `${scene.veoPrompt}, no text overlay, no subtitles, 9:16 vertical aspect ratio`
  return base
}

// 기존 단일 프롬프트 빌더 (Shotstack 폴백용으로 유지)
export function buildVeoPrompt(
  scenario: VideoScenario,
  productName: string,
  language: string = 'ko',
): string {
  // scenes가 있으면 hero 씬(씬2) 프롬프트 우선 사용
  if (scenario.scenes && scenario.scenes.length >= 2) {
    const heroScene = scenario.scenes[1]
    return `${heroScene.veoPrompt}, no text overlay, 9:16 vertical, 8 seconds`
  }

  const points = scenario.performancePoints.slice(0, 2).join(', ')
  if (language === 'ja') {
    return (
      `High-quality 8-second commercial product video. Product: ${productName}. ` +
      `Key message: ${scenario.hook}. Features: ${points}. ` +
      `Vertical 9:16, dramatic product reveal on marble surface, studio lighting, ` +
      `dynamic camera movement, no text overlay, clean background, 4K`
    )
  }
  // ko/en 공통 — @everyday-c 스타일 (마블 테이블, 드라마틱 등장)
  return (
    `8-second product showcase video, ${productName} dramatically revealed on white marble surface, ` +
    `professional studio lighting with rim light, slow 360 rotation or zoom-in reveal, ` +
    `Korean shopping channel aesthetic, clean white/gradient background, ` +
    `cinematic slow motion, no text overlay, 9:16 vertical, 4K high quality`
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
