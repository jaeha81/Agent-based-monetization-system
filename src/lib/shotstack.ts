import type { VideoScenario } from './agents/scenario-agent'

const BASE = 'https://api.shotstack.io'
const STAGE = () => (process.env.SHOTSTACK_STAGE === 'v1' ? 'v1' : 'stage')

// BOM 및 공백 제거
const getShotstackKey = () => process.env.SHOTSTACK_API_KEY?.replace(/^﻿/, '').trim()

// 로열티프리 음악 풀 (Incompetech/Kevin MacLeod — CC BY 3.0, 직접 접근 확인)
const MUSIC_POOL = [
  'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Americana.mp3',
  'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Beach%20Party.mp3',
  'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bright%20Wish.mp3',
  'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Cool%20Vibes.mp3',
]

function pickMusic(seed: string): string {
  let sum = 0
  for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i)
  return MUSIC_POOL[sum % MUSIC_POOL.length]
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
): Promise<string> {
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const bg = BG_GRADIENTS[Math.abs(scenario.hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length]
  const [bgFrom, bgTo] = bg.split(',').slice(0, 2)

  const scenes = buildAllScenes(scenario, productName, bgFrom, bgTo, affiliateUrl)

  const ttsText = (scenario.ttsScript || `${scenario.hook}. ${productName}.`).slice(0, 500)
  const ttsVoice = language === 'ko' ? 'Seoyeon' : language === 'ja' ? 'Mizuki' : 'Amy'

  // data: URI는 Shotstack이 다운로드 불가 → https:// URL만 허용
  const safeImageUrl = imageUrl?.startsWith('https://') ? imageUrl : null
  const imageTracks = safeImageUrl
    ? [{ clips: [{ asset: { type: 'image', src: safeImageUrl }, start: 7, length: 11, fit: 'cover', opacity: 0.4, effect: 'zoomIn' }] }]
    : []

  // TTS 나레이션 생성 (Shotstack Ingest API - AWS Polly Seoyeon)
  const ttsUrl = await generateShotstackTTS(ttsText, ttsVoice)
  const bgMusic = pickMusic(productName)

  // TTS 성공: 나레이션(1.0) + 배경음악(0.12) / 실패: 배경음악만(0.8)
  const body = buildRenderBody(scenes, imageTracks, ttsUrl ?? bgMusic, callbackUrl, ttsUrl ? bgMusic : undefined)

  const res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.warn('[Shotstack] 시나리오 렌더 실패, 배경음악만으로 재시도:', errText.slice(0, 200))
    return submitShotstackScenicRenderWithMusic(scenario, productName, imageUrl, language, callbackUrl, affiliateUrl)
  }

  const { response } = await res.json() as { response: { id: string } }
  return response.id
}

// 4씬 + 배경음악만 (TTS 실패 폴백)
async function submitShotstackScenicRenderWithMusic(
  scenario: VideoScenario,
  productName: string,
  imageUrl: string | null,
  language: string,
  callbackUrl?: string,
  affiliateUrl?: string,
): Promise<string> {
  const key = getShotstackKey()!

  const bg = BG_GRADIENTS[Math.abs(scenario.hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length]
  const [bgFrom, bgTo] = bg.split(',').slice(0, 2)

  const scenes = buildAllScenes(scenario, productName, bgFrom, bgTo, affiliateUrl)
  const safeImageUrl2 = imageUrl?.startsWith('https://') ? imageUrl : null
  const imageTracks = safeImageUrl2
    ? [{ clips: [{ asset: { type: 'image', src: safeImageUrl2 }, start: 7, length: 11, fit: 'cover', opacity: 0.4, effect: 'zoomIn' }] }]
    : []

  const body = buildRenderBody(scenes, imageTracks, pickMusic(productName), callbackUrl)

  const res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Shotstack 렌더 실패: ${await res.text()}`)
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
    ? [{ clips: [{ asset: { type: 'audio', src: ttsOrMusicSrc, volume: 1.0 }, start: 0, length: 30 }] }]
    : []

  const timeline: Record<string, unknown> = {
    tracks: [
      ...narrationTrack,
      ...imageTracks,
      { clips: scenes },
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
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const bg = BG_GRADIENTS[Math.abs(hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length]
  const html = buildSimpleHtml(hook.slice(0, 40), productName, language, bg, affiliateUrl)

  const ttsText = script ? script.slice(0, 500) : `${hook}. ${productName}. 구매 링크는 설명란에 있습니다.`
  const ttsVoice = language === 'ko' ? 'Seoyeon' : language === 'ja' ? 'Mizuki' : 'Amy'
  const ttsUrl = await generateShotstackTTS(ttsText, ttsVoice)
  const bgMusic = pickMusic(hook)

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
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const bg = BG_GRADIENTS[Math.abs(hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length]
  const html = buildSimpleHtml(hook.slice(0, 40), productName, language, bg, affiliateUrl)
  const ttsText = script ? script.slice(0, 500) : `${hook}. ${productName}. 구매 링크는 설명란에 있습니다.`
  const ttsVoice = language === 'ko' ? 'Seoyeon' : language === 'ja' ? 'Mizuki' : 'Amy'
  const ttsUrl = await generateShotstackTTS(ttsText, ttsVoice)
  const bgMusic = pickMusic(hook)

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
function generateShotstackTTS(text: string, voice: string = 'Seoyeon'): string | null {
  if (!process.env.GOOGLE_TTS_API_KEY) return null
  const lang = voice === 'Seoyeon' ? 'ko' : voice === 'Mizuki' ? 'ja' : 'en'
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shorts-dashboard-one.vercel.app'
  return `${baseUrl}/api/tts?text=${encodeURIComponent(text.slice(0, 500))}&lang=${lang}`
}

// ─── 음원 URL 빌드: TTS 나레이션 → 로열티프리 음악 폴백 ────────────────────────
// ⚠️ Google TTS는 base64 data URI 반환 → Shotstack src로 사용 불가 → 제거
async function buildSoundtrackSrc(text: string, voice: string, language: string): Promise<string> {
  // 1순위: Shotstack Ingest TTS (AWS Polly - 실제 한국어 음성)
  const voiceName = language === 'ko' ? 'Seoyeon' : language === 'ja' ? 'Mizuki' : voice
  const ttsUrl = await generateShotstackTTS(text, voiceName)
  if (ttsUrl) return ttsUrl

  // 2순위: 로열티프리 배경음악 (항상 작동)
  return pickMusic(text.slice(0, 10))
}

// ─── 씬 HTML 빌더 ─────────────────────────────────────────────────────────────
function buildAllScenes(
  scenario: VideoScenario,
  productName: string,
  bgFrom: string,
  bgTo: string,
  affiliateUrl?: string,
) {
  return [
    // 씬1: 훅 (0-7초)
    { asset: { type: 'html', html: buildScene1Hook(scenario.hook, bgFrom, bgTo), width: 1080, height: 1920 }, start: 0, length: 7, fit: 'none' },
    // 씬2: 성능 포인트 (7-18초)
    { asset: { type: 'html', html: buildScene2Performance(productName, scenario.performancePoints, bgFrom, bgTo), width: 1080, height: 1920 }, start: 7, length: 11, fit: 'none' },
    // 씬3: 가격 (18-25초)
    { asset: { type: 'html', html: buildScene3Price(productName, scenario, bgFrom, bgTo), width: 1080, height: 1920 }, start: 18, length: 7, fit: 'none' },
    // 씬4: CTA (25-30초)
    { asset: { type: 'html', html: buildScene4CTA(scenario.cta, bgFrom, bgTo, affiliateUrl), width: 1080, height: 1920 }, start: 25, length: 5, fit: 'none' },
  ]
}

function buildScene1Hook(hook: string, bgFrom: string, bgTo: string): string {
  return `<div style="width:1080px;height:1920px;background:linear-gradient(160deg,${bgFrom},${bgTo});display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center;position:relative">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at center,rgba(255,255,255,0.05) 0%,transparent 70%)"></div>
    <div style="font-size:40px;font-weight:700;opacity:0.7;margin-bottom:32px;letter-spacing:4px;text-transform:uppercase">✨ TRENDING NOW</div>
    <div style="font-size:92px;font-weight:900;line-height:1.15;text-shadow:0 4px 32px rgba(0,0,0,0.7);letter-spacing:-2px;word-break:keep-all;max-width:940px;background:linear-gradient(135deg,#fff 60%,#FFD700);-webkit-background-clip:text;-webkit-text-fill-color:transparent">${hook}</div>
    <div style="margin-top:60px;width:120px;height:6px;background:linear-gradient(90deg,#FFD700,#FF6B35);border-radius:3px"></div>
  </div>`
}

function buildScene2Performance(productName: string, points: string[], bgFrom: string, bgTo: string): string {
  const items = points.slice(0, 3).map((p, i) =>
    `<div style="display:flex;align-items:center;gap:28px;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.20);border-radius:24px;padding:32px 40px;margin-bottom:20px;width:100%;box-sizing:border-box;backdrop-filter:blur(10px)">
      <div style="font-size:56px;font-weight:900;color:#FFD700;min-width:64px;text-shadow:0 2px 12px rgba(255,215,0,0.5)">${['①','②','③'][i]}</div>
      <div style="font-size:46px;font-weight:700;line-height:1.3;word-break:keep-all;text-align:left">${p}</div>
    </div>`
  ).join('')
  return `<div style="width:1080px;height:1920px;background:linear-gradient(160deg,${bgFrom},${bgTo});display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff">
    <div style="font-size:44px;font-weight:800;margin-bottom:40px;text-align:center;letter-spacing:-1px;color:#FFD700">✅ 핵심 성능 포인트</div>
    <div style="font-size:36px;font-weight:600;opacity:0.7;margin-bottom:48px;text-align:center;word-break:keep-all">${productName}</div>
    ${items}
  </div>`
}

function buildScene3Price(productName: string, scenario: VideoScenario, bgFrom: string, bgTo: string): string {
  const priceBlock = scenario.originalPrice
    ? `<div style="font-size:44px;font-weight:700;opacity:0.55;text-decoration:line-through;margin-bottom:12px">${scenario.originalPrice}</div>
       <div style="font-size:96px;font-weight:900;color:#FF4757;text-shadow:0 4px 24px rgba(255,71,87,0.6);margin-bottom:24px">${scenario.salePrice}</div>`
    : `<div style="font-size:72px;font-weight:900;color:#FFD700;text-shadow:0 4px 24px rgba(255,215,0,0.5);margin-bottom:24px">${scenario.priceText}</div>`
  return `<div style="width:1080px;height:1920px;background:linear-gradient(160deg,${bgFrom},${bgTo});display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center">
    <div style="font-size:52px;font-weight:800;margin-bottom:48px">💰 지금 이 가격!</div>
    ${priceBlock}
    <div style="font-size:48px;font-weight:700;background:rgba(255,71,87,0.2);border:2px solid rgba(255,71,87,0.6);border-radius:20px;padding:24px 56px">${scenario.priceText}</div>
    <div style="margin-top:40px;font-size:36px;font-weight:600;opacity:0.7;word-break:keep-all">${productName}</div>
  </div>`
}

function buildScene4CTA(cta: string, bgFrom: string, bgTo: string, affiliateUrl?: string): string {
  const urlDisplay = affiliateUrl
    ? affiliateUrl.length > 42 ? affiliateUrl.slice(0, 42) + '…' : affiliateUrl
    : null
  return `<div style="width:1080px;height:1920px;background:linear-gradient(160deg,${bgFrom},${bgTo});display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center">
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
