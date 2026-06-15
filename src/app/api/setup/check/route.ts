import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  const keys = {
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    COUPANG_ACCESS_KEY: !!process.env.COUPANG_ACCESS_KEY,
    COUPANG_SECRET_KEY: !!process.env.COUPANG_SECRET_KEY,
    YOUTUBE_CLIENT_ID: !!process.env.YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET: !!process.env.YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REFRESH_TOKEN: !!process.env.YOUTUBE_REFRESH_TOKEN,
    CRON_SECRET: !!process.env.CRON_SECRET,
  }

  const allRequired = keys.ANTHROPIC_API_KEY && keys.COUPANG_ACCESS_KEY && keys.CRON_SECRET
  const youtubeReady = keys.YOUTUBE_CLIENT_ID && keys.YOUTUBE_REFRESH_TOKEN

  return NextResponse.json({
    keys,
    allRequired,
    youtubeReady,
    automationReady: allRequired,
    mockMode: process.env.USE_MOCK_DATA === 'true',
  })
}
