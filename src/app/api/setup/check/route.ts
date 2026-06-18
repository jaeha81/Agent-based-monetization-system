import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const keys = {
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    COUPANG_ACCESS_KEY: !!process.env.COUPANG_ACCESS_KEY,
    COUPANG_SECRET_KEY: !!process.env.COUPANG_SECRET_KEY,
    YOUTUBE_CLIENT_ID: !!process.env.YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET: !!process.env.YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REFRESH_TOKEN: !!process.env.YOUTUBE_REFRESH_TOKEN,
    CRON_SECRET: !!process.env.CRON_SECRET,
    SHOTSTACK_API_KEY: !!process.env.SHOTSTACK_API_KEY,
    TISTORY_ACCESS_TOKEN: !!process.env.TISTORY_ACCESS_TOKEN,
    AMAZON_ASSOCIATE_TAG_US: !!process.env.AMAZON_ASSOCIATE_TAG_US,
    AMAZON_ASSOCIATE_TAG_JP: !!process.env.AMAZON_ASSOCIATE_TAG_JP,
    SHORTS_DISCORD_WEBHOOK: !!process.env.SHORTS_DISCORD_WEBHOOK,
    SHORTS_DISCORD_APPLICATION_ID: !!process.env.SHORTS_DISCORD_APPLICATION_ID,
    SHORTS_DISCORD_BOT_TOKEN: !!process.env.SHORTS_DISCORD_BOT_TOKEN,
    INSTAGRAM_ACCESS_TOKEN: !!process.env.INSTAGRAM_ACCESS_TOKEN,
    INSTAGRAM_USER_ID: !!process.env.INSTAGRAM_USER_ID,
    TIKTOK_ACCESS_TOKEN: !!process.env.TIKTOK_ACCESS_TOKEN,
    TIKTOK_OPEN_ID: !!process.env.TIKTOK_OPEN_ID,
    FACEBOOK_PAGE_ACCESS_TOKEN: !!process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
    FACEBOOK_PAGE_ID: !!process.env.FACEBOOK_PAGE_ID,
  }

  const allRequired = keys.GEMINI_API_KEY && keys.CRON_SECRET
  const youtubeReady = keys.YOUTUBE_CLIENT_ID && keys.YOUTUBE_REFRESH_TOKEN
  const videoReady = youtubeReady && keys.SHOTSTACK_API_KEY
  const blogReady = keys.TISTORY_ACCESS_TOKEN
  const globalReady = keys.AMAZON_ASSOCIATE_TAG_US || keys.AMAZON_ASSOCIATE_TAG_JP
  const activeMarkets = (process.env.TARGET_MARKETS || 'KR').split(',').map(m => m.trim())

  return NextResponse.json({
    keys,
    allRequired,
    youtubeReady,
    videoReady,
    blogReady,
    globalReady,
    activeMarkets,
    automationReady: allRequired,
    mockMode: process.env.USE_MOCK_DATA === 'true',
  })
}
