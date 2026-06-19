import type { VideoScenario } from './agents/scenario-agent'

const BASE = 'https://api.shotstack.io'

const STAGE = () => (process.env.SHOTSTACK_STAGE === 'v1' ? 'v1' : 'stage')

// BOM(﻿) 및 공백 제거 — Vercel 환경변수 복붙 시 오염 방지
const getShotstackKey = () => process.env.SHOTSTACK_API_KEY?.replace(/^﻿/, '').trim()

// 비동기 제출 — render_id만 반환, 폴링 없음 (webhook으로 완료 수신)
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

  const cta =
    language === 'ja' ? '🛒 説明欄リンクから購入'
    : language === 'ko' ? '🛒 설명란 링크에서 구매'
    : '🛒 Buy link in description'

  const bg = BG_GRADIENTS[Math.floor(Math.abs(hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length)]
  const html = buildVideoHtml(hook.slice(0, 40), productName, cta, bg, affiliateUrl)

  // TTS 음성 텍스트 (script 없으면 hook + productName 조합)
  const ttsText = script
    ? script.slice(0, 500)
    : `${hook}. ${productName}. 구매 링크는 설명란에 있습니다.`

  const ttsVoice = language === 'ko' ? 'Seoyeon' : language === 'ja' ? 'Mizuki' : 'Amy'

  const body: Record<string, unknown> = {
    timeline: {
      soundtrack: {
        src: `[[tts:${JSON.stringify({ text: ttsText, voice: ttsVoice, speed: 0.95 })}]]`,
        effect: 'fadeOut',
        volume: 1,
      },
      tracks: [
        {
          clips: [
            {
              asset: { type: 'html', html, width: 1080, height: 1920 },
              start: 0,
              length: 30,
              fit: 'none',
            },
          ],
        },
      ],
    },
    output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 },
  }

  if (callbackUrl) {
    body.callback = callbackUrl
  }

  const res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // TTS 실패 시 무음으로 재시도
    const errText = await res.text()
    console.warn('[Shotstack] TTS 포함 렌더 실패, 무음으로 재시도:', errText)
    return submitShotstackRenderSilent(hook, productName, language, callbackUrl, affiliateUrl)
  }

  const { response } = await res.json() as { response: { id: string } }
  return response.id
}

async function submitShotstackRenderSilent(
  hook: string,
  productName: string,
  language: string,
  callbackUrl?: string,
  affiliateUrl?: string,
): Promise<string> {
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const cta =
    language === 'ja' ? '🛒 説明欄リンクから購入'
    : language === 'ko' ? '🛒 설명란 링크에서 구매'
    : '🛒 Buy link in description'

  const bg = BG_GRADIENTS[Math.floor(Math.abs(hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length)]
  const html = buildVideoHtml(hook.slice(0, 40), productName, cta, bg, affiliateUrl)

  const body: Record<string, unknown> = {
    timeline: {
      tracks: [{ clips: [{ asset: { type: 'html', html, width: 1080, height: 1920 }, start: 0, length: 30, fit: 'none' }] }],
    },
    output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 },
  }
  if (callbackUrl) body.callback = callbackUrl

  const res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Shotstack 제출 실패: ${await res.text()}`)
  const { response } = await res.json() as { response: { id: string } }
  return response.id
}

// 단일 폴링 체크 (webhook 불가 시 수동 확인용)
export async function pollShotstackRender(renderId: string): Promise<{ status: string; url?: string; error?: string }> {
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const res = await fetch(`${BASE}/${STAGE()}/render/${renderId}`, { headers: { 'x-api-key': key } })
  const { response } = await res.json() as { response: { status: string; url?: string; error?: string } }
  return { status: response.status, url: response.url, error: response.error }
}

const BG_GRADIENTS = [
  '#0f0c29,#302b63,#24243e',
  '#1a1a2e,#16213e,#0f3460',
  '#1d2671,#c33764',
  '#0f2027,#203a43,#2c5364',
  '#360033,#0b8793',
]

function buildVideoHtml(
  hook: string,
  productName: string,
  cta: string,
  bgPair: string,
  affiliateUrl?: string,
): string {
  const [from, to] = bgPair.split(',').slice(0, 2)

  // 구매 URL 표시: 너무 길면 앞 40자만
  const urlDisplay = affiliateUrl
    ? affiliateUrl.length > 45
      ? affiliateUrl.slice(0, 45) + '…'
      : affiliateUrl
    : null

  return `<div style="
    width:1080px;height:1920px;
    background:linear-gradient(160deg,${from},${to});
    display:flex;flex-direction:column;
    justify-content:center;align-items:center;
    padding:80px;box-sizing:border-box;
    font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;
    color:#fff;text-align:center">

    <!-- 훅 텍스트 -->
    <div style="font-size:86px;font-weight:900;line-height:1.2;margin-bottom:48px;
      text-shadow:0 4px 24px rgba(0,0,0,0.6);letter-spacing:-2px;
      word-break:keep-all;max-width:940px">${hook}</div>

    <!-- 제품명 -->
    <div style="font-size:46px;font-weight:600;opacity:0.90;margin-bottom:60px;
      line-height:1.4;max-width:900px;word-break:keep-all">${productName}</div>

    <!-- CTA 버튼 -->
    <div style="font-size:42px;font-weight:700;
      background:rgba(255,255,255,0.18);
      border:2px solid rgba(255,255,255,0.35);
      padding:28px 60px;border-radius:100px;
      backdrop-filter:blur(8px);margin-bottom:${urlDisplay ? '36px' : '0'}">${cta}</div>

    ${urlDisplay ? `
    <!-- 구매 URL -->
    <div style="font-size:28px;font-weight:500;opacity:0.75;
      font-family:monospace;letter-spacing:0;
      background:rgba(0,0,0,0.3);padding:18px 36px;border-radius:16px;
      max-width:940px;word-break:break-all">${urlDisplay}</div>
    ` : ''}
  </div>`
}

// 4씬 시나리오 기반 렌더 (비동기 제출, webhook 완료 수신)
export async function submitShotstackScenicRender(
  scenario: VideoScenario,
  productName: string,
  imageBase64: string | null,
  language: string = 'ko',
  callbackUrl?: string,
  affiliateUrl?: string,
): Promise<string> {
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const cta =
    language === 'ja' ? '🛒 説明欄リンクから購入'
    : language === 'ko' ? '🛒 설명란 링크에서 구매'
    : '🛒 Buy link in description'

  const bg = BG_GRADIENTS[Math.floor(Math.abs(scenario.hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length)]
  const [bgFrom, bgTo] = bg.split(',').slice(0, 2)

  // 씬별 HTML 클립 빌드
  const scene1Html = buildSceneHtml('hook', scenario.hook, null, null, bgFrom, bgTo)
  const scene2Html = buildSceneHtml('performance', productName, scenario.performancePoints, null, bgFrom, bgTo)
  const scene3Html = buildSceneHtml('price', productName, null, { originalPrice: scenario.originalPrice, salePrice: scenario.salePrice, priceText: scenario.priceText }, bgFrom, bgTo)
  const scene4Html = buildSceneHtml('cta', productName, null, null, bgFrom, bgTo, scenario.cta, affiliateUrl)

  const ttsText = scenario.ttsScript?.slice(0, 500) || `${scenario.hook}. ${productName}.`
  const ttsVoice = language === 'ko' ? 'Seoyeon' : language === 'ja' ? 'Mizuki' : 'Amy'

  const imageTracks = imageBase64
    ? [{
        clips: [{
          asset: { type: 'image', src: imageBase64 },
          start: 7,
          length: 11,
          fit: 'cover',
          opacity: 0.3,
        }],
      }]
    : []

  const body: Record<string, unknown> = {
    timeline: {
      soundtrack: {
        src: `[[tts:${JSON.stringify({ text: ttsText, voice: ttsVoice, speed: 0.95 })}]]`,
        effect: 'fadeOut',
        volume: 1,
      },
      tracks: [
        ...imageTracks,
        {
          clips: [
            { asset: { type: 'html', html: scene1Html, width: 1080, height: 1920 }, start: 0, length: 7, fit: 'none' },
            { asset: { type: 'html', html: scene2Html, width: 1080, height: 1920 }, start: 7, length: 11, fit: 'none' },
            { asset: { type: 'html', html: scene3Html, width: 1080, height: 1920 }, start: 18, length: 7, fit: 'none' },
            { asset: { type: 'html', html: scene4Html, width: 1080, height: 1920 }, start: 25, length: 5, fit: 'none' },
          ],
        },
      ],
    },
    output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 },
  }

  if (callbackUrl) body.callback = callbackUrl

  const res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.warn('[Shotstack] 시나리오 렌더 실패, 단순 렌더로 폴백:', errText)
    return submitShotstackRender(scenario.hook, productName, language, callbackUrl, scenario.ttsScript, affiliateUrl)
  }

  const { response } = await res.json() as { response: { id: string } }
  return response.id
}

function buildSceneHtml(
  type: 'hook' | 'performance' | 'price' | 'cta',
  productName: string,
  performancePoints: string[] | null,
  priceInfo: { originalPrice: string; salePrice: string; priceText: string } | null,
  bgFrom: string,
  bgTo: string,
  cta?: string,
  affiliateUrl?: string,
): string {
  const urlDisplay = affiliateUrl
    ? affiliateUrl.length > 45 ? affiliateUrl.slice(0, 45) + '…' : affiliateUrl
    : null

  if (type === 'hook') {
    return `<div style="width:1080px;height:1920px;background:linear-gradient(160deg,${bgFrom},${bgTo});display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center">
      <div style="font-size:96px;font-weight:900;line-height:1.15;text-shadow:0 4px 24px rgba(0,0,0,0.6);letter-spacing:-2px;word-break:keep-all;max-width:940px">${productName}</div>
    </div>`
  }

  if (type === 'performance' && performancePoints) {
    const items = performancePoints.slice(0, 3).map((p, i) =>
      `<div style="display:flex;align-items:center;gap:24px;background:rgba(255,255,255,0.12);border-radius:20px;padding:28px 40px;margin-bottom:24px;width:100%;box-sizing:border-box">
        <div style="font-size:52px;font-weight:900;color:#FFD700;min-width:60px">${['①', '②', '③'][i]}</div>
        <div style="font-size:44px;font-weight:700;line-height:1.3;word-break:keep-all;text-align:left">${p}</div>
      </div>`
    ).join('')
    return `<div style="width:1080px;height:1920px;background:linear-gradient(160deg,${bgFrom},${bgTo});display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff">
      <div style="font-size:52px;font-weight:800;margin-bottom:48px;text-align:center;letter-spacing:-1px">✅ 핵심 성능 포인트</div>
      ${items}
    </div>`
  }

  if (type === 'price' && priceInfo) {
    const { originalPrice, salePrice, priceText } = priceInfo
    const priceBlock = originalPrice
      ? `<div style="font-size:48px;font-weight:700;opacity:0.6;text-decoration:line-through;margin-bottom:16px">${originalPrice}</div>
         <div style="font-size:88px;font-weight:900;color:#FF4757;text-shadow:0 4px 16px rgba(255,71,87,0.5);margin-bottom:32px">${salePrice}</div>`
      : `<div style="font-size:64px;font-weight:800;color:#FFD700;margin-bottom:32px">${priceText}</div>`
    return `<div style="width:1080px;height:1920px;background:linear-gradient(160deg,${bgFrom},${bgTo});display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center">
      <div style="font-size:52px;font-weight:800;margin-bottom:48px">💰 지금 이 가격!</div>
      ${priceBlock}
      <div style="font-size:44px;font-weight:700;background:rgba(255,255,255,0.15);border-radius:20px;padding:24px 48px">${priceText}</div>
    </div>`
  }

  // CTA scene
  return `<div style="width:1080px;height:1920px;background:linear-gradient(160deg,${bgFrom},${bgTo});display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;box-sizing:border-box;font-family:'Apple SD Gothic Neo','Noto Sans KR',Arial,sans-serif;color:#fff;text-align:center">
    <div style="font-size:72px;font-weight:900;background:linear-gradient(135deg,#FFD700,#FF6B35);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:48px;word-break:keep-all;max-width:940px">${cta || '지금 바로 확인!'}</div>
    <div style="font-size:42px;font-weight:700;background:rgba(255,255,255,0.18);border:2px solid rgba(255,255,255,0.35);padding:28px 60px;border-radius:100px;margin-bottom:${urlDisplay ? '36px' : '0'}">🛒 설명란 링크에서 구매</div>
    ${urlDisplay ? `<div style="font-size:28px;font-weight:500;opacity:0.75;font-family:monospace;background:rgba(0,0,0,0.3);padding:18px 36px;border-radius:16px;max-width:940px;word-break:break-all">${urlDisplay}</div>` : ''}
  </div>`
}

// 즉시 게시용 (blocking poll — 최대 5분)
export async function renderShortsVideo(
  hook: string,
  productName: string,
  language: string = 'ko',
  script?: string,
  affiliateUrl?: string,
): Promise<string> {
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const cta =
    language === 'ja' ? '🛒 説明欄リンクから購入'
    : language === 'ko' ? '🛒 설명란 링크에서 구매'
    : '🛒 Buy link in description'

  const bg = BG_GRADIENTS[Math.floor(Math.abs(hook.length * 7 + productName.length * 3) % BG_GRADIENTS.length)]
  const html = buildVideoHtml(hook.slice(0, 40), productName, cta, bg, affiliateUrl)

  const ttsText = script
    ? script.slice(0, 500)
    : `${hook}. ${productName}. 구매 링크는 설명란에 있습니다.`
  const ttsVoice = language === 'ko' ? 'Seoyeon' : language === 'ja' ? 'Mizuki' : 'Amy'

  const makeBody = (withTts: boolean) => ({
    timeline: {
      ...(withTts ? {
        soundtrack: {
          src: `[[tts:${JSON.stringify({ text: ttsText, voice: ttsVoice, speed: 0.95 })}]]`,
          effect: 'fadeOut',
          volume: 1,
        },
      } : {}),
      tracks: [{ clips: [{ asset: { type: 'html', html, width: 1080, height: 1920 }, start: 0, length: 30, fit: 'none' }] }],
    },
    output: { format: 'mp4', resolution: '1080', aspectRatio: '9:16', fps: 30 },
  })

  let renderId: string
  let res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(makeBody(true)),
  })
  if (!res.ok) {
    // TTS 실패 시 무음으로 재시도
    console.warn('[Shotstack] TTS 실패, 무음 재시도')
    res = await fetch(`${BASE}/${STAGE()}/render`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(false)),
    })
    if (!res.ok) throw new Error(`Shotstack 렌더 요청 실패: ${await res.text()}`)
  }

  const { response } = await res.json() as { response: { id: string } }
  renderId = response.id

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const poll = await fetch(`${BASE}/${STAGE()}/render/${renderId}`, { headers: { 'x-api-key': key } })
    const { response: r } = await poll.json() as { response: { status: string; url?: string; error?: string } }
    if (r.status === 'done' && r.url) return r.url
    if (r.status === 'failed') throw new Error(`Shotstack 렌더 실패: ${r.error}`)
  }
  throw new Error('Shotstack 렌더 타임아웃 (5분)')
}
