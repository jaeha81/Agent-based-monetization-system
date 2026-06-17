const BASE = 'https://api.shotstack.io'

const STAGE = () => (process.env.SHOTSTACK_STAGE === 'v1' ? 'v1' : 'stage')

const BG_GRADIENTS = [
  '#0f0c29,#302b63,#24243e',
  '#1a1a2e,#16213e,#0f3460',
  '#1d2671,#c33764',
  '#0f2027,#203a43,#2c5364',
  '#360033,#0b8793',
]

function buildVideoHtml(hook: string, productName: string, cta: string, bgPair: string): string {
  const [from, to] = bgPair.split(',').slice(0, 2)
  return `<div style="
    width:1080px;height:1920px;
    background:linear-gradient(160deg,${from},${to});
    display:flex;flex-direction:column;
    justify-content:center;align-items:center;
    padding:80px;box-sizing:border-box;
    font-family:'Helvetica Neue',Arial,sans-serif;
    color:#fff;text-align:center">
    <div style="font-size:90px;font-weight:900;line-height:1.15;margin-bottom:48px;
      text-shadow:0 4px 24px rgba(0,0,0,0.6);letter-spacing:-1px">${hook}</div>
    <div style="font-size:48px;font-weight:600;opacity:0.85;margin-bottom:72px;
      line-height:1.4">${productName}</div>
    <div style="font-size:44px;font-weight:700;
      background:rgba(255,255,255,0.18);
      border:2px solid rgba(255,255,255,0.35);
      padding:28px 60px;border-radius:100px;
      backdrop-filter:blur(8px)">${cta}</div>
  </div>`
}

export async function renderShortsVideo(
  hook: string,
  productName: string,
  language: string = 'ko',
): Promise<string> {
  const key = process.env.SHOTSTACK_API_KEY
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const cta =
    language === 'ja' ? '🛒 説明欄のリンクから購入'
    : language === 'ko' ? '🛒 설명란 링크에서 구매'
    : '🛒 Buy link in description'

  const bg = BG_GRADIENTS[Math.floor(Math.random() * BG_GRADIENTS.length)]
  const html = buildVideoHtml(hook.slice(0, 40), productName, cta, bg)

  const body = {
    timeline: {
      tracks: [{ clips: [{ asset: { type: 'html', html, width: 1080, height: 1920 }, start: 0, length: 30, fit: 'none' }] }],
    },
    output: { format: 'mp4', resolution: 'hd', aspectRatio: '9:16', fps: 30 },
  }

  const res = await fetch(`${BASE}/${STAGE()}/render`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Shotstack 렌더 요청 실패: ${await res.text()}`)

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
