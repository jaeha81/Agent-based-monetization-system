import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 15

// GET /api/tts?text=...&voice=Seoyeon&lang=ko
// Shotstack이 이 URL에서 직접 MP3를 다운로드 (GOOGLE_TTS_API_KEY 필요)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const text = searchParams.get('text') || ''
  const lang = searchParams.get('lang') || 'ko'

  if (!text) return new NextResponse(null, { status: 400 })

  const googleKey = process.env.GOOGLE_TTS_API_KEY?.replace(/^﻿/, '').trim()
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
