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
  const key = process.env.SHOTSTACK_API_KEY!

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
