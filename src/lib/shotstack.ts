import type { VideoScenario } from './agents/scenario-agent'

const BASE = 'https://api.shotstack.io'
const STAGE = () => (process.env.SHOTSTACK_STAGE === 'v1' ? 'v1' : 'stage')

// BOM 및 공백 제거
const getShotstackKey = () => process.env.SHOTSTACK_API_KEY?.replace(/^﻿/, '').trim()

// 무료 배경음악 (Shotstack 공개 에셋)
const BG_MUSIC_URL = 'https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/unminus/commercial-advertisement.mp3'

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

  const imageTracks = imageUrl
    ? [{ clips: [{ asset: { type: 'image', src: imageUrl }, start: 7, length: 11, fit: 'cover', opacity: 0.4, effect: 'zoomIn' }] }]
    : []

  // TTS: Google Cloud TTS 키 있으면 사용, 없으면 배경음악
  const soundtrackSrc = await buildSoundtrackSrc(ttsText, ttsVoice, language)

  const body = buildRenderBody(scenes, imageTracks, soundtrackSrc, callbackUrl)

  const res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.warn('[Shotstack] 시나리오 렌더 실패, 배경음악으로 재시도:', errText.slice(0, 200))
    // 4씬 유지하되 배경음악만으로 폴백 (1씬으로 가지 않음)
    return submitShotstackScenicRenderWithMusic(scenario, productName, imageUrl, language, callbackUrl, affiliateUrl)
  }

  const { response } = await res.json() as { response: { id: string } }
  return response.id
}

// 4씬 + 배경음악 (TTS 폴백)
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
  const imageTracks = imageUrl
    ? [{ clips: [{ asset: { type: 'image', src: imageUrl }, start: 7, length: 11, fit: 'cover', opacity: 0.4, effect: 'zoomIn' }] }]
    : []

  const body = buildRenderBody(scenes, imageTracks, BG_MUSIC_URL, callbackUrl)

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
  soundtrackSrc: string,
  callbackUrl?: string,
) {
  const body: Record<string, unknown> = {
    timeline: {
      soundtrack: { src: soundtrackSrc, effect: 'fadeOut', volume: 0.8 },
      tracks: [
        ...imageTracks,
        { clips: scenes },
      ],
    },
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
  const soundtrackSrc = await buildSoundtrackSrc(ttsText, ttsVoice, language)

  const body: Record<string, unknown> = {
    timeline: {
      soundtrack: { src: soundtrackSrc, effect: 'fadeOut', volume: 0.8 },
      tracks: [{ clips: [{ asset: { type: 'html', html, width: 1080, height: 1920 }, start: 0, length: 30, fit: 'none' }] }],
    },
    output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 },
  }
  if (callbackUrl) body.callback = callbackUrl

  let res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    // 배경음악으로 재시도
    ;(body.timeline as Record<string, unknown>).soundtrack = { src: BG_MUSIC_URL, effect: 'fadeOut', volume: 0.8 }
    res = await fetch(`${BASE}/${STAGE()}/render`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
  const soundtrackSrc = await buildSoundtrackSrc(ttsText, ttsVoice, language)

  const makeBody = (soundtrack: string) => ({
    timeline: {
      soundtrack: { src: soundtrack, effect: 'fadeOut', volume: 0.8 },
      tracks: [{ clips: [{ asset: { type: 'html', html, width: 1080, height: 1920 }, start: 0, length: 30, fit: 'none' }] }],
    },
    output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 },
  })

  let res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(makeBody(soundtrackSrc)),
  })
  if (!res.ok) {
    console.warn('[Shotstack] TTS 실패, 배경음악으로 재시도')
    res = await fetch(`${BASE}/${STAGE()}/render`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(BG_MUSIC_URL)),
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

// ─── TTS 음원 URL 빌드 ────────────────────────────────────────────────────────
async function buildSoundtrackSrc(text: string, voice: string, language: string): Promise<string> {
  // Google Cloud TTS (키 있을 때만)
  const googleKey = process.env.GOOGLE_TTS_API_KEY?.replace(/^﻿/, '').trim()
  if (googleKey) {
    try {
      const langCode = language === 'ko' ? 'ko-KR' : language === 'ja' ? 'ja-JP' : 'en-US'
      const ttsRes = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text: text.slice(0, 500) },
            voice: { languageCode: langCode, name: voice === 'Seoyeon' ? 'ko-KR-Wavenet-A' : voice === 'Mizuki' ? 'ja-JP-Wavenet-A' : 'en-US-Wavenet-F' },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
          }),
        }
      )
      if (ttsRes.ok) {
        const { audioContent } = await ttsRes.json() as { audioContent: string }
        // Google TTS는 base64 MP3 반환 — data URI로 Shotstack에 전달
        return `data:audio/mp3;base64,${audioContent}`
      }
    } catch { /* 폴백 */ }
  }

  // 배경음악 폴백 (항상 사용 가능)
  return BG_MUSIC_URL
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
