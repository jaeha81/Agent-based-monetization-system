import type { VideoScenario } from './agents/scenario-agent'
import { execute, query } from '@/lib/db'
import { createTtsToken } from '@/lib/tts-auth'

const BASE = 'https://api.shotstack.io/edit'
const STAGE = () => (process.env.SHOTSTACK_STAGE === 'v1' ? 'v1' : 'stage')

// BOM 및 공백 제거
const getShotstackKey = () => process.env.SHOTSTACK_API_KEY?.replace(/^﻿/, '').trim()

async function assertShotstackCircuit(): Promise<void> {
  const circuit = await query<{ value: string }>("SELECT value FROM settings WHERE key = 'circuit:shotstack'").catch(() => [])
  if (circuit[0]?.value === 'open') {
    throw new Error('NON_RETRYABLE_PROVIDER: Shotstack 회로가 열려 있습니다. 크레딧 충전 후 설정을 초기화하세요.')
  }
}

function isQuotaFailure(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('credits required') || lower.includes('plan limits') || lower.includes('insufficient credit') || lower.includes('quota')
}

async function throwShotstackError(prefix: string, response: Response): Promise<never> {
  const detail = await response.text()
  if (isQuotaFailure(detail)) {
    await execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('circuit:shotstack', 'open', datetime('now'))").catch(() => {})
    throw new Error(`NON_RETRYABLE_PROVIDER: ${prefix}: ${detail}`)
  }
  throw new Error(`${prefix}: ${detail}`)
}

async function pickMusic(seed: string, contentId?: number): Promise<string> {
  const tracks = await query<{ id: string; url: string; performance_score: number; uses: number }>(`
    SELECT id, url, performance_score, uses FROM music_tracks
    WHERE active = 1 AND commercial_use = 1
    ORDER BY performance_score DESC, uses ASC
  `).catch(() => [])
  if (tracks.length === 0) throw new Error('렌더 차단: 상업 이용권이 검증된 활성 음악이 없습니다.')
  const hash = `${contentId || 0}:${seed}`.split('').reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)
  const explore = hash % 5 === 0
  const selected = explore ? tracks[hash % tracks.length] : tracks[0]
  const propensity = explore
    ? 0.2 / tracks.length
    : 0.8 + 0.2 / tracks.length
  await execute('UPDATE music_tracks SET uses = uses + 1 WHERE id = ?', [selected.id]).catch(() => {})
  if (contentId) {
    await execute(
      `INSERT INTO music_assignments
       (assignment_key, music_track_id, content_id, explore, propensity, policy_version, assigned_at)
       VALUES (?, ?, ?, ?, ?, 'music-v1', datetime('now'))
       ON CONFLICT(content_id) DO UPDATE SET music_track_id = excluded.music_track_id,
         explore = excluded.explore, propensity = excluded.propensity,
         policy_version = excluded.policy_version, assigned_at = excluded.assigned_at`,
      [`content:${contentId}`, selected.id, contentId, explore ? 1 : 0, propensity]
    )
    await execute('UPDATE content SET music_track_id = ? WHERE id = ?', [selected.id, contentId])
  }
  return selected.url
}

const BG_GRADIENTS = [
  '#0f0c29,#302b63,#24243e',
  '#1a1a2e,#16213e,#0f3460',
  '#1d2671,#c33764',
  '#0f2027,#203a43,#2c5364',
  '#360033,#0b8793',
]

// 단일 폴링 체크 (webhook 불가 시 수동 확인용)
export async function pollShotstackRender(renderId: string): Promise<{ status: string; url?: string; error?: string }> {
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')
  const res = await fetch(`${BASE}/${STAGE()}/render/${renderId}`, { headers: { 'x-api-key': key } })
  const { response } = await res.json() as { response: { status: string; url?: string; error?: string } }
  return { status: response.status, url: response.url, error: response.error }
}

// ─── 4씬 시나리오 기반 렌더 (TTS 포함) ───────────────────────────────────────
export async function submitShotstackScenicRender(
  scenario: VideoScenario,
  productName: string,
  imageUrl: string | null,
  language: string = 'ko',
  callbackUrl?: string,
  affiliateUrl?: string,
  contentId?: number,
): Promise<string> {
  await assertShotstackCircuit()
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const bg = BG_GRADIENTS[Math.abs(scenario.hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length]
  const [bgFrom, bgTo] = bg.split(',').slice(0, 2)

  const ttsText = (scenario.ttsScript || `${scenario.hook}. ${productName}.`).slice(0, 500)
  const ttsVoice = language === 'ko' ? 'Seoyeon' : language === 'ja' ? 'Mizuki' : 'Amy'

  // data: URI는 Shotstack이 다운로드 불가 → https:// URL만 허용
  const safeImageUrl = imageUrl?.startsWith('https://') ? imageUrl : null
  const scenes = buildAllScenes(scenario, productName, bgFrom, bgTo, affiliateUrl, Boolean(safeImageUrl))
  const imageTracks = buildProductImageTracks(safeImageUrl)

  // TTS 나레이션 생성 (Shotstack Ingest API - AWS Polly Seoyeon)
  const ttsUrl = await generateShotstackTTS(ttsText, ttsVoice)
  if (!ttsUrl) throw new Error('렌더 차단: GOOGLE_TTS_API_KEY가 없어 필수 나레이션을 생성할 수 없습니다.')
  const bgMusic = await pickMusic(productName, contentId)

  // TTS 성공: 나레이션(1.0) + 배경음악(0.12) / 실패: 배경음악만(0.8)
  const body = buildRenderBody(scenes, imageTracks, ttsUrl ?? bgMusic, callbackUrl, ttsUrl ? bgMusic : undefined)

  const res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    if (isQuotaFailure(errText)) {
      await execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('circuit:shotstack', 'open', datetime('now'))").catch(() => {})
      throw new Error(`NON_RETRYABLE_PROVIDER: Shotstack 렌더 실패: ${errText}`)
    }
    console.warn('[Shotstack] 시나리오 렌더 실패, 배경음악만으로 재시도:', errText.slice(0, 200))
    throw new Error(`Shotstack scenic render failed: ${errText.slice(0, 500)}`)
  }

  const { response } = await res.json() as { response: { id: string } }
  return response.id
}

// 4씬 + 배경음악만 (TTS 실패 폴백)
export async function submitShotstackScenicRenderWithMusic(
  scenario: VideoScenario,
  productName: string,
  imageUrl: string | null,
  language: string,
  callbackUrl?: string,
  affiliateUrl?: string,
): Promise<string> {
  await assertShotstackCircuit()
  const key = getShotstackKey()!

  const bg = BG_GRADIENTS[Math.abs(scenario.hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length]
  const [bgFrom, bgTo] = bg.split(',').slice(0, 2)

  const safeImageUrl2 = imageUrl?.startsWith('https://') ? imageUrl : null
  const scenes = buildAllScenes(scenario, productName, bgFrom, bgTo, affiliateUrl, Boolean(safeImageUrl2))
  const imageTracks = buildProductImageTracks(safeImageUrl2)

  const body = buildRenderBody(scenes, imageTracks, await pickMusic(productName), callbackUrl)

  const res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) await throwShotstackError('Shotstack 렌더 실패', res)
  const { response } = await res.json() as { response: { id: string } }
  return response.id
}

function buildRenderBody(
  scenes: ReturnType<typeof buildAllScenes>,
  imageTracks: object[],
  ttsOrMusicSrc: string,
  callbackUrl?: string,
  bgMusicSrc?: string,
) {
  // TTS가 있으면 나레이션 트랙(볼륨 1.0) + 배경음악(볼륨 0.12) 분리
  // TTS 없으면 음악만 사운드트랙(볼륨 0.8)
  const hasTTS = ttsOrMusicSrc.startsWith('http') && bgMusicSrc

  const narrationTrack = hasTTS
    ? [{ clips: [{ asset: { type: 'audio', src: ttsOrMusicSrc, volume: 1.0 }, start: 0, length: 25 }] }]
    : []

  const timeline: Record<string, unknown> = {
    tracks: [
      ...narrationTrack,
      { clips: scenes },
      ...imageTracks,
    ],
  }

  const musicSrc = hasTTS ? bgMusicSrc! : ttsOrMusicSrc
  if (musicSrc) timeline.soundtrack = { src: musicSrc, effect: 'fadeOut', volume: hasTTS ? 0.12 : 0.8 }

  const body: Record<string, unknown> = {
    timeline,
    output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 },
  }
  if (callbackUrl) body.callback = callbackUrl
  return body
}

// ─── 빠른 제출 (비동기, webhook 대기) ─────────────────────────────────────────
export async function submitShotstackRender(
  hook: string,
  productName: string,
  language: string = 'ko',
  callbackUrl?: string,
  script?: string,
  affiliateUrl?: string,
): Promise<string> {
  await assertShotstackCircuit()
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const bg = BG_GRADIENTS[Math.abs(hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length]
  const html = buildSimpleHtml(hook.slice(0, 40), productName, language, bg, affiliateUrl)

  const ttsText = script ? script.slice(0, 500) : `${hook}. ${productName}. 구매 링크는 설명란에 있습니다.`
  const ttsVoice = language === 'ko' ? 'Seoyeon' : language === 'ja' ? 'Mizuki' : 'Amy'
  const ttsUrl = await generateShotstackTTS(ttsText, ttsVoice)
  if (!ttsUrl) throw new Error('렌더 차단: GOOGLE_TTS_API_KEY가 없어 필수 나레이션을 생성할 수 없습니다.')
  const bgMusic = await pickMusic(hook)

  const makeTimeline = (tts: string | null, music: string) => {
    const tracks: unknown[] = []
    if (tts) tracks.push({ clips: [{ asset: { type: 'audio', src: tts, volume: 1.0 }, start: 0, length: 30 }] })
    tracks.push({ clips: [{ asset: { type: 'html', html, width: 1080, height: 1920 }, start: 0, length: 30, fit: 'none' }] })
    const timeline: Record<string, unknown> = { tracks }
    if (music) timeline.soundtrack = { src: music, effect: 'fadeOut', volume: tts ? 0.12 : 0.8 }
    return { timeline, output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 } }
  }

  const body: Record<string, unknown> = { ...makeTimeline(ttsUrl, bgMusic) }
  if (callbackUrl) body.callback = callbackUrl

  let res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const firstError = await res.clone().text()
    if (isQuotaFailure(firstError)) await throwShotstackError('Shotstack 제출 실패', res)
    // TTS 없이 배경음악만으로 재시도
    const fallback = { ...makeTimeline(null, bgMusic) }
    if (callbackUrl) (fallback as Record<string, unknown>).callback = callbackUrl
    res = await fetch(`${BASE}/${STAGE()}/render`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(fallback),
    })
    if (!res.ok) throw new Error(`Shotstack 제출 실패: ${await res.text()}`)
  }

  const { response } = await res.json() as { response: { id: string } }
  return response.id
}

// ─── 즉시 게시용 (blocking poll, 최대 5분) ────────────────────────────────────
export async function renderShortsVideo(
  hook: string,
  productName: string,
  language: string = 'ko',
  script?: string,
  affiliateUrl?: string,
): Promise<string> {
  await assertShotstackCircuit()
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const bg = BG_GRADIENTS[Math.abs(hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length]
  const html = buildSimpleHtml(hook.slice(0, 40), productName, language, bg, affiliateUrl)
  const ttsText = script ? script.slice(0, 500) : `${hook}. ${productName}. 구매 링크는 설명란에 있습니다.`
  const ttsVoice = language === 'ko' ? 'Seoyeon' : language === 'ja' ? 'Mizuki' : 'Amy'
  const ttsUrl = await generateShotstackTTS(ttsText, ttsVoice)
  if (!ttsUrl) throw new Error('렌더 차단: GOOGLE_TTS_API_KEY가 없어 필수 나레이션을 생성할 수 없습니다.')
  const bgMusic = await pickMusic(hook)

  const makeBody = (tts: string | null, music: string) => {
    const tracks: unknown[] = []
    if (tts) tracks.push({ clips: [{ asset: { type: 'audio', src: tts, volume: 1.0 }, start: 0, length: 30 }] })
    tracks.push({ clips: [{ asset: { type: 'html', html, width: 1080, height: 1920 }, start: 0, length: 30, fit: 'none' }] })
    const timeline: Record<string, unknown> = { tracks }
    if (music) timeline.soundtrack = { src: music, effect: 'fadeOut', volume: tts ? 0.12 : 0.8 }
    return { timeline, output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 } }
  }

  let res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(makeBody(ttsUrl, bgMusic)),
  })
  if (!res.ok) {
    const firstError = await res.clone().text()
    if (isQuotaFailure(firstError)) await throwShotstackError('Shotstack 렌더 요청 실패', res)
    // TTS 없이 배경음악만으로 재시도
    res = await fetch(`${BASE}/${STAGE()}/render`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(null, bgMusic)),
    })
    if (!res.ok) throw new Error(`Shotstack 렌더 요청 실패: ${await res.text()}`)
  }

  const { response } = await res.json() as { response: { id: string } }
  const renderId = response.id

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const poll = await fetch(`${BASE}/${STAGE()}/render/${renderId}`, { headers: { 'x-api-key': key } })
    const { response: r } = await poll.json() as { response: { status: string; url?: string; error?: string } }
    if (r.status === 'done' && r.url) return r.url
    if (r.status === 'failed') throw new Error(`Shotstack 렌더 실패: ${r.error}`)
  }
  throw new Error('Shotstack 렌더 타임아웃 (5분)')
}

// ─── Vercel TTS 프록시 URL 생성 (Shotstack이 직접 다운로드) ────────────────────
// GOOGLE_TTS_API_KEY 설정 시 한국어 음성 반환, 미설정 시 null → 음악만 사용
async function generateShotstackTTS(text: string, voice: string = 'Seoyeon'): Promise<string | null> {
  if (!process.env.GOOGLE_TTS_API_KEY && !process.env.LOCAL_TTS_URL) return null
  const lang = voice === 'Seoyeon' ? 'ko' : voice === 'Mizuki' ? 'ja' : 'en'
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shorts-dashboard-one.vercel.app'
  const safeText = text.slice(0, 500)
  const token = await createTtsToken(safeText, lang)
  return `${baseUrl}/api/tts?text=${encodeURIComponent(safeText)}&lang=${lang}&token=${encodeURIComponent(token)}`
}

// ─── 씬 HTML 빌더 ─────────────────────────────────────────────────────────────
function buildAllScenes(
  scenario: VideoScenario,
  productName: string,
  bgFrom: string,
  bgTo: string,
  affiliateUrl?: string,
  hasProductImage: boolean = false,
) {
  return [
    // 씬1: 훅 (0-7초)
    { asset: { type: 'html', html: buildScene1Hook(scenario.hook, bgFrom, bgTo), width: 1080, height: 1920 }, start: 0, length: 3, fit: 'none' },
    // 씬2: 성능 포인트 (7-18초)
    { asset: { type: 'html', html: buildScene2Hero(productName, bgFrom, bgTo, hasProductImage), width: 1080, height: 1920 }, start: 3, length: 6, fit: 'none' },
    { asset: { type: 'html', html: buildScene2Performance(productName, scenario.performancePoints, bgFrom, bgTo, hasProductImage), width: 1080, height: 1920 }, start: 9, length: 6, fit: 'none' },
    // 씬3: 가격 (18-25초)
    { asset: { type: 'html', html: buildScene3Price(productName, scenario, bgFrom, bgTo, hasProductImage), width: 1080, height: 1920 }, start: 15, length: 5, fit: 'none' },
    // 씬4: CTA (25-30초)
    { asset: { type: 'html', html: buildScene4CTA(scenario.cta, bgFrom, bgTo, affiliateUrl, hasProductImage), width: 1080, height: 1920 }, start: 20, length: 5, fit: 'none' },
  ]
}

function buildProductImageTracks(imageUrl: string | null): object[] {
  if (!imageUrl) return []
  const clip = (start: number, length: number, opacity: number, effect: 'zoomIn' | 'zoomOut') => ({
    asset: { type: 'image', src: imageUrl }, start, length, fit: 'crop', opacity, effect,
  })
  return [{ clips: [
    clip(0, 3, 0.25, 'zoomIn'), clip(3, 6, 1, 'zoomIn'), clip(9, 6, 1, 'zoomOut'),
    clip(15, 5, 0.88, 'zoomIn'), clip(20, 5, 0.32, 'zoomOut'),
  ] }]
}

function sceneBackground(bgFrom: string, bgTo: string, hasProductImage: boolean, strength = 0.72): string {
  return hasProductImage
    ? `linear-gradient(180deg,rgba(0,0,0,0.10),rgba(0,0,0,${strength}))`
    : `linear-gradient(160deg,${bgFrom},${bgTo})`
}

function buildScene2Hero(productName: string, bgFrom: string, bgTo: string, hasProductImage: boolean): string {
  return `<div style="width:1080px;height:1920px;background:${sceneBackground(bgFrom, bgTo, hasProductImage, 0.62)};display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding:120px 80px 250px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center">
    <div style="font-size:34px;font-weight:800;letter-spacing:5px;color:#FFD700;margin-bottom:24px">PRODUCT CHECK</div>
    <div style="font-size:64px;font-weight:900;line-height:1.18;text-shadow:0 4px 24px rgba(0,0,0,0.9);word-break:keep-all;max-width:920px">${productName}</div>
  </div>`
}

function buildScene1Hook(hook: string, bgFrom: string, bgTo: string): string {
  return `<div style="width:1080px;height:1920px;background:linear-gradient(160deg,${bgFrom},${bgTo});display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center;position:relative">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at center,rgba(255,255,255,0.05) 0%,transparent 70%)"></div>
    <div style="font-size:40px;font-weight:700;opacity:0.7;margin-bottom:32px;letter-spacing:4px;text-transform:uppercase">✨ TRENDING NOW</div>
    <div style="font-size:92px;font-weight:900;line-height:1.15;text-shadow:0 4px 32px rgba(0,0,0,0.7);letter-spacing:-2px;word-break:keep-all;max-width:940px;background:linear-gradient(135deg,#fff 60%,#FFD700);-webkit-background-clip:text;-webkit-text-fill-color:transparent">${hook}</div>
    <div style="margin-top:60px;width:120px;height:6px;background:linear-gradient(90deg,#FFD700,#FF6B35);border-radius:3px"></div>
  </div>`
}

function buildScene2Performance(productName: string, points: string[], bgFrom: string, bgTo: string, hasProductImage: boolean): string {
  const items = points.slice(0, 3).map((p, i) =>
    `<div style="display:flex;align-items:center;gap:28px;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.20);border-radius:24px;padding:32px 40px;margin-bottom:20px;width:100%;box-sizing:border-box;backdrop-filter:blur(10px)">
      <div style="font-size:56px;font-weight:900;color:#FFD700;min-width:64px;text-shadow:0 2px 12px rgba(255,215,0,0.5)">${['①','②','③'][i]}</div>
      <div style="font-size:46px;font-weight:700;line-height:1.3;word-break:keep-all;text-align:left">${p}</div>
    </div>`
  ).join('')
  return `<div style="width:1080px;height:1920px;background:${sceneBackground(bgFrom, bgTo, hasProductImage, 0.82)};display:flex;flex-direction:column;justify-content:center;align-items:center;padding:160px 80px 240px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff">
    <div style="font-size:44px;font-weight:800;margin-bottom:40px;text-align:center;letter-spacing:-1px;color:#FFD700">✅ 핵심 성능 포인트</div>
    <div style="font-size:36px;font-weight:600;opacity:0.7;margin-bottom:48px;text-align:center;word-break:keep-all">${productName}</div>
    ${items}
  </div>`
}

function buildScene3Price(productName: string, scenario: VideoScenario, bgFrom: string, bgTo: string, hasProductImage: boolean): string {
  const priceBlock = scenario.originalPrice
    ? `<div style="font-size:44px;font-weight:700;opacity:0.55;text-decoration:line-through;margin-bottom:12px">${scenario.originalPrice}</div>
       <div style="font-size:96px;font-weight:900;color:#FF4757;text-shadow:0 4px 24px rgba(255,71,87,0.6);margin-bottom:24px">${scenario.salePrice}</div>`
    : `<div style="font-size:72px;font-weight:900;color:#FFD700;text-shadow:0 4px 24px rgba(255,215,0,0.5);margin-bottom:24px">${scenario.priceText}</div>`
  return `<div style="width:1080px;height:1920px;background:${sceneBackground(bgFrom, bgTo, hasProductImage, 0.86)};display:flex;flex-direction:column;justify-content:center;align-items:center;padding:160px 80px 240px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center">
    <div style="font-size:52px;font-weight:800;margin-bottom:48px">💰 지금 이 가격!</div>
    ${priceBlock}
    <div style="font-size:48px;font-weight:700;background:rgba(255,71,87,0.2);border:2px solid rgba(255,71,87,0.6);border-radius:20px;padding:24px 56px">${scenario.priceText}</div>
    <div style="margin-top:40px;font-size:36px;font-weight:600;opacity:0.7;word-break:keep-all">${productName}</div>
  </div>`
}

function buildScene4CTA(cta: string, bgFrom: string, bgTo: string, affiliateUrl?: string, hasProductImage: boolean = false): string {
  const urlDisplay = affiliateUrl
    ? affiliateUrl.length > 42 ? affiliateUrl.slice(0, 42) + '…' : affiliateUrl
    : null
  return `<div style="width:1080px;height:1920px;background:${sceneBackground(bgFrom, bgTo, hasProductImage, 0.90)};display:flex;flex-direction:column;justify-content:center;align-items:center;padding:160px 80px 260px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center">
    <div style="font-size:80px;font-weight:900;line-height:1.2;background:linear-gradient(135deg,#FFD700,#FF6B35);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:52px;word-break:keep-all;max-width:940px">${cta}</div>
    <div style="font-size:44px;font-weight:700;background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.4);padding:28px 64px;border-radius:100px;margin-bottom:${urlDisplay ? '36px' : '0'}">🛒 설명란 링크에서 구매</div>
    ${urlDisplay ? `<div style="font-size:26px;font-weight:500;opacity:0.7;font-family:monospace;background:rgba(0,0,0,0.35);padding:18px 36px;border-radius:16px;max-width:940px;word-break:break-all">${urlDisplay}</div>` : ''}
  </div>`
}

// ─── 단일씬 간단 HTML (폴백 전용) ─────────────────────────────────────────────
function buildSimpleHtml(hook: string, productName: string, language: string, bgPair: string, affiliateUrl?: string): string {
  const [from, to] = bgPair.split(',').slice(0, 2)
  const cta = language === 'ja' ? '🛒 説明欄リンクから購入' : language === 'ko' ? '🛒 설명란 링크에서 구매' : '🛒 Buy link in description'
  const urlDisplay = affiliateUrl ? (affiliateUrl.length > 45 ? affiliateUrl.slice(0, 45) + '…' : affiliateUrl) : null
  return `<div style="width:1080px;height:1920px;background:linear-gradient(160deg,${from},${to});display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center">
    <div style="font-size:86px;font-weight:900;line-height:1.2;margin-bottom:48px;text-shadow:0 4px 24px rgba(0,0,0,0.6);letter-spacing:-2px;word-break:keep-all;max-width:940px">${hook}</div>
    <div style="font-size:46px;font-weight:600;opacity:0.90;margin-bottom:60px;line-height:1.4;max-width:900px;word-break:keep-all">${productName}</div>
    <div style="font-size:42px;font-weight:700;background:rgba(255,255,255,0.18);border:2px solid rgba(255,255,255,0.35);padding:28px 60px;border-radius:100px;margin-bottom:${urlDisplay ? '36px' : '0'}">${cta}</div>
    ${urlDisplay ? `<div style="font-size:28px;font-weight:500;opacity:0.75;font-family:monospace;background:rgba(0,0,0,0.3);padding:18px 36px;border-radius:16px;max-width:940px;word-break:break-all">${urlDisplay}</div>` : ''}
  </div>`
}
