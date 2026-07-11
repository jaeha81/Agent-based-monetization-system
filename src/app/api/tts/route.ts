import { NextRequest, NextResponse } from 'next/server'
import { verifyTtsToken } from '@/lib/tts-auth'

export const runtime = 'nodejs'
export const maxDuration = 30

// GET /api/tts?text=...&voice=Seoyeon&lang=ko
// Shotstack이 이 URL에서 직접 MP3를 다운로드 (GOOGLE_TTS_API_KEY 필요)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const text = searchParams.get('text') || ''
  const lang = searchParams.get('lang') || 'ko'
  const token = searchParams.get('token')

  if (!text) return new NextResponse(null, { status: 400 })
  if (!await verifyTtsToken(text.slice(0, 500), lang, token)) return new NextResponse(null, { status: 401 })

  const googleKey = process.env.GOOGLE_TTS_API_KEY?.replace(/^﻿/, '').trim()
  const localTtsUrl = process.env.LOCAL_TTS_URL?.replace(/\/$/, '').trim()
  const localTtsToken = process.env.LOCAL_TTS_TOKEN?.trim()

  if (!googleKey && localTtsUrl) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 25_000)
      const res = await fetch(`${localTtsUrl}/synthesize`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'skip_zrok_interstitial': '1',
          ...(localTtsToken ? { Authorization: `Bearer ${localTtsToken}` } : {}),
        },
        body: JSON.stringify({ text: text.slice(0, 500), lang }),
      })
      clearTimeout(timeout)
      if (!res.ok) return new NextResponse(null, { status: 502 })
      const buffer = Buffer.from(await res.arrayBuffer())
      if (!buffer.length) return new NextResponse(null, { status: 502 })
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': res.headers.get('content-type') || 'audio/mpeg',
          'Content-Length': String(buffer.length),
          'Cache-Control': 'public, max-age=3600',
        },
      })
    } catch {
      return new NextResponse(null, { status: 502 })
    }
  }

  if (!googleKey) return new NextResponse(null, { status: 503 })

  const langCode = lang === 'ko' ? 'ko-KR' : lang === 'ja' ? 'ja-JP' : 'en-US'
  const voiceName = lang === 'ko' ? 'ko-KR-Wavenet-A' : lang === 'ja' ? 'ja-JP-Wavenet-A' : 'en-US-Wavenet-F'

  try {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: text.slice(0, 500) },
          voice: { languageCode: langCode, name: voiceName },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 },
        }),
      }
    )

    if (!res.ok) return new NextResponse(null, { status: 502 })

    const { audioContent } = await res.json() as { audioContent: string }
    const buffer = Buffer.from(audioContent, 'base64')

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
