const BASE = 'https://api.shotstack.io'
const TTS_BASE = 'https://api.shotstack.io/create/v1'

const STAGE = () => (process.env.SHOTSTACK_STAGE === 'v1' ? 'v1' : 'stage')

// BOM(﻿) 및 공백 제거 — Vercel 환경변수 복붙 시 오염 방지
const getShotstackKey = () => process.env.SHOTSTACK_API_KEY?.replace(/^﻿/, '').trim()

// 배경음악 (로열티프리, Shotstack 예제 CDN)
const BG_MUSIC = 'https://s3-ap-southeast-2.amazonaws.com/shotstack-assets/footage/music/unminus-indulge.mp3'

// 카테고리별 배경 이미지 (Unsplash 퍼블릭 CDN)
const CATEGORY_IMAGES: Record<string, string> = {
  '스포츠': 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1080&q=85',
  '운동': 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1080&q=85',
  '헬스': 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1080&q=85',
  '뷰티': 'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=1080&q=85',
  '화장품': 'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=1080&q=85',
  '유아': 'https://images.unsplash.com/photo-1566004100631-35d015d6a491?w=1080&q=85',
  '아기': 'https://images.unsplash.com/photo-1566004100631-35d015d6a491?w=1080&q=85',
  '생활': 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1080&q=85',
  '주방': 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1080&q=85',
  '식품': 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1080&q=85',
  '음식': 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1080&q=85',
  '전자': 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1080&q=85',
  '가전': 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1080&q=85',
  '패션': 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=1080&q=85',
  '의류': 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=1080&q=85',
}

const DEFAULT_BG = 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1080&q=85'

// 언어별 TTS 설정 (Google TTS via Shotstack)
const TTS_VOICES: Record<string, { language: string; voice: string }> = {
  ko: { language: 'ko-KR', voice: 'ko-KR-Standard-A' },
  en: { language: 'en-US', voice: 'en-US-Standard-C' },
  ja: { language: 'ja-JP', voice: 'ja-JP-Standard-A' },
}

function getCategoryImage(category: string): string {
  for (const [key, url] of Object.entries(CATEGORY_IMAGES)) {
    if (category.includes(key)) return url
  }
  return DEFAULT_BG
}

// TTS용 텍스트 정제 — 이모지, 특수문자 제거
function sanitizeForTTS(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')  // 이모지 제거
    .replace(/[#*_~`>|[\]]/g, '')             // 마크다운 특수문자
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250)
}

// Shotstack Create API로 한국어 TTS 생성 → 오디오 URL 반환 (실패 시 null)
async function generateTTS(script: string, language: string = 'ko'): Promise<string | null> {
  const key = getShotstackKey()
  if (!key) return null

  const ttsText = sanitizeForTTS(script)
  if (!ttsText) return null

  const { language: langCode, voice } = TTS_VOICES[language] || TTS_VOICES.ko

  try {
    // Step 1: TTS 작업 제출
    const submitRes = await fetch(`${TTS_BASE}/tts`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ttsText, language: langCode, voice }),
    })

    if (!submitRes.ok) {
      console.warn('[TTS] 제출 실패:', await submitRes.text())
      return null
    }

    const submitData = await submitRes.json() as { data?: { id: string }; response?: { id: string } }
    const ttsId = submitData.data?.id || submitData.response?.id
    if (!ttsId) {
      console.warn('[TTS] ID 반환 없음')
      return null
    }

    // Step 2: 완료 폴링 (최대 60초)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const pollRes = await fetch(`${TTS_BASE}/tts/${ttsId}`, {
        headers: { 'x-api-key': key },
      })
      const pollData = await pollRes.json() as {
        data?: { status: string; url?: string; error?: string }
        response?: { status: string; url?: string; error?: string }
      }
      const r = pollData.data || pollData.response
      if (!r) continue
      if (r.status === 'done' && r.url) {
        console.log('[TTS] 생성 완료:', r.url)
        return r.url
      }
      if (r.status === 'failed') {
        console.warn('[TTS] 생성 실패:', r.error)
        return null
      }
    }

    console.warn('[TTS] 타임아웃 (60초)')
    return null
  } catch (e) {
    console.warn('[TTS] 오류 (배경음악만 사용):', e)
    return null
  }
}

function buildVideoHtml(
  hook: string,
  productName: string,
  cta: string,
  bgImageUrl: string,
): string {
  const hookFontSize = hook.length > 22 ? '76px' : hook.length > 16 ? '86px' : '96px'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
@keyframes fadeInUp{
  from{opacity:0;transform:translateY(70px)}
  to{opacity:1;transform:translateY(0)}
}
@keyframes slideInLeft{
  from{opacity:0;transform:translateX(-60px)}
  to{opacity:1;transform:translateX(0)}
}
@keyframes scaleIn{
  from{opacity:0;transform:scale(0.75)}
  to{opacity:1;transform:scale(1)}
}
@keyframes pulseGlow{
  0%,100%{box-shadow:0 16px 48px rgba(255,59,48,0.45)}
  50%{box-shadow:0 20px 72px rgba(255,59,48,0.85)}
}
html,body{
  width:1080px;height:1920px;overflow:hidden;
  font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;
  background:#111;
}
.bg{
  position:absolute;top:0;left:0;
  width:1080px;height:1920px;
  object-fit:cover;z-index:0;
}
.overlay{
  position:absolute;inset:0;z-index:1;
  background:linear-gradient(
    180deg,
    rgba(0,0,0,0.10) 0%,
    rgba(0,0,0,0.30) 35%,
    rgba(0,0,0,0.72) 60%,
    rgba(0,0,0,0.93) 80%,
    rgba(0,0,0,0.97) 100%
  );
}
.content{
  position:absolute;inset:0;z-index:2;
  display:flex;flex-direction:column;
  justify-content:flex-end;
  padding:72px 72px 170px;
}
.badge{
  display:inline-flex;align-items:center;gap:14px;
  background:linear-gradient(135deg,#FF3B30,#FF6B35);
  color:#fff;font-size:40px;font-weight:700;
  padding:18px 44px;border-radius:100px;
  margin-bottom:48px;align-self:flex-start;
  letter-spacing:-0.5px;
  animation:slideInLeft 0.55s cubic-bezier(.22,1,.36,1) 0.2s both;
}
.hook{
  font-size:${hookFontSize};font-weight:900;color:#fff;
  line-height:1.18;margin-bottom:36px;
  text-shadow:0 6px 32px rgba(0,0,0,0.85);
  word-break:keep-all;letter-spacing:-1.5px;
  animation:fadeInUp 0.7s cubic-bezier(.22,1,.36,1) 0.45s both;
}
.product{
  font-size:50px;font-weight:700;
  color:rgba(255,255,255,0.88);
  line-height:1.42;margin-bottom:64px;
  word-break:keep-all;
  animation:fadeInUp 0.7s cubic-bezier(.22,1,.36,1) 0.7s both;
}
.cta{
  background:linear-gradient(135deg,#FF3B30,#FF6B35);
  color:#fff;font-size:56px;font-weight:900;
  padding:52px 80px;border-radius:100px;
  text-align:center;letter-spacing:-0.5px;
  animation:scaleIn 0.6s cubic-bezier(.22,1,.36,1) 0.95s both,
             pulseGlow 2.8s ease-in-out 1.8s infinite;
}
</style>
</head>
<body>
<img class="bg" src="${bgImageUrl}" crossorigin="anonymous" />
<div class="overlay"></div>
<div class="content">
  <div class="badge">🔥 지금 핫딜</div>
  <div class="hook">${hook}</div>
  <div class="product">${productName}</div>
  <div class="cta">${cta}</div>
</div>
</body>
</html>`
}

function buildTimeline(html: string, voiceoverUrl?: string | null) {
  const hasVoice = !!voiceoverUrl
  const tracks: unknown[] = [
    {
      clips: [{
        asset: { type: 'html', html, width: 1080, height: 1920 },
        start: 0,
        length: 30,
        fit: 'none',
      }],
    },
  ]

  if (hasVoice) {
    tracks.push({
      clips: [{
        asset: { type: 'audio', src: voiceoverUrl, volume: 1.0 },
        start: 0,
        length: 30,
      }],
    })
  }

  return {
    timeline: {
      soundtrack: {
        src: BG_MUSIC,
        effect: 'fadeInFadeOut',
        // 음성 있으면 배경음악 낮춤, 없으면 전체 볼륨
        volume: hasVoice ? 0.12 : 0.30,
      },
      tracks,
    },
    output: { format: 'mp4', resolution: 'hd', aspectRatio: '9:16', fps: 30 },
  }
}

// 비동기 제출 — render_id만 반환, 폴링 없음 (webhook으로 완료 수신)
export async function submitShotstackRender(
  hook: string,
  productName: string,
  language: string = 'ko',
  callbackUrl?: string,
  imageUrl?: string,
  category?: string,
  script?: string,
): Promise<string> {
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const cta =
    language === 'ja' ? '🛒 説明欄のリンクから購入'
    : language === 'ko' ? '🛒 설명란 링크에서 구매'
    : '🛒 Buy link in description'

  const bgImage = imageUrl || getCategoryImage(category || '')
  const html = buildVideoHtml(hook.slice(0, 40), productName, cta, bgImage)

  // TTS 생성 (실패해도 배경음악만으로 계속 진행)
  let voiceoverUrl: string | null = null
  if (script) {
    const ttsScript = `${sanitizeForTTS(hook)}. ${sanitizeForTTS(script)}`
    voiceoverUrl = await generateTTS(ttsScript, language)
  }

  const bodyBase = buildTimeline(html, voiceoverUrl)
  const body: Record<string, unknown> = { ...bodyBase }

  if (callbackUrl) {
    body.callback = callbackUrl
  }

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

export async function renderShortsVideo(
  hook: string,
  productName: string,
  language: string = 'ko',
  imageUrl?: string,
  category?: string,
  script?: string,
): Promise<string> {
  const key = getShotstackKey()
  if (!key) throw new Error('SHOTSTACK_API_KEY 미설정')

  const cta =
    language === 'ja' ? '🛒 説明欄のリンクから購入'
    : language === 'ko' ? '🛒 설명란 링크에서 구매'
    : '🛒 Buy link in description'

  const bgImage = imageUrl || getCategoryImage(category || '')
  const html = buildVideoHtml(hook.slice(0, 40), productName, cta, bgImage)

  // TTS 생성 (실패해도 계속 진행)
  let voiceoverUrl: string | null = null
  if (script) {
    const ttsScript = `${sanitizeForTTS(hook)}. ${sanitizeForTTS(script)}`
    voiceoverUrl = await generateTTS(ttsScript, language)
  }

  const body = buildTimeline(html, voiceoverUrl)

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
