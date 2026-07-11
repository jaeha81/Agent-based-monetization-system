import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { getProductionConfigurationStatus } from '@/lib/provider-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const configuration = getProductionConfigurationStatus()
  const keys = {
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    COUPANG_ACCESS_KEY: !!process.env.COUPANG_ACCESS_KEY,
    COUPANG_SECRET_KEY: !!process.env.COUPANG_SECRET_KEY,
    YOUTUBE_CLIENT_ID: !!process.env.YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET: !!process.env.YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REFRESH_TOKEN: !!process.env.YOUTUBE_REFRESH_TOKEN,
    CRON_SECRET: !!process.env.CRON_SECRET,
    DASHBOARD_PASSWORD: !!process.env.DASHBOARD_PASSWORD,
    NEXT_PUBLIC_APP_URL: !!process.env.NEXT_PUBLIC_APP_URL,
    UPLOAD_SECRET: !!process.env.UPLOAD_SECRET,
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
    GOOGLE_TTS_API_KEY: !!process.env.GOOGLE_TTS_API_KEY,
    YOUTUBE_API_KEY: !!(process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY),
    TURSO_DATABASE_URL: !!process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: !!process.env.TURSO_AUTH_TOKEN,
    SHOTSTACK_WEBHOOK_SECRET: !!process.env.SHOTSTACK_WEBHOOK_SECRET,
    TTS_SIGNING_SECRET: !!process.env.TTS_SIGNING_SECRET,
    CLICK_HASH_SECRET: !!process.env.CLICK_HASH_SECRET,
    SHORTS_DISCORD_ADMIN_USER_IDS: !!process.env.SHORTS_DISCORD_ADMIN_USER_IDS,
  }

  const affiliateReady = keys.COUPANG_ACCESS_KEY && keys.COUPANG_SECRET_KEY
  const youtubeReady = keys.YOUTUBE_CLIENT_ID && keys.YOUTUBE_CLIENT_SECRET && keys.YOUTUBE_REFRESH_TOKEN
  const databaseReady = keys.TURSO_DATABASE_URL && keys.TURSO_AUTH_TOKEN
  const videoReady = youtubeReady && keys.SHOTSTACK_API_KEY && keys.GOOGLE_TTS_API_KEY && keys.SHOTSTACK_WEBHOOK_SECRET && keys.TTS_SIGNING_SECRET
  const marketTrendReady = keys.YOUTUBE_API_KEY
  const uploadReady = keys.UPLOAD_SECRET
  const allRequired = configuration.ok
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
    affiliateReady,
    databaseReady,
    marketTrendReady,
    uploadReady,
    autoPublishEnabled: process.env.AUTO_PUBLISH_ENABLED === 'true',
    autoPublishDailyLimit: Number(process.env.AUTO_PUBLISH_DAILY_LIMIT || 2),
    costDefaults: {
      veo: Number(process.env.COST_VEO_RENDER_KRW || 700),
      shotstack: Number(process.env.COST_SHOTSTACK_RENDER_KRW || 250),
      image: Number(process.env.COST_IMAGE_GENERATION_KRW || 60),
      tts: Number(process.env.COST_TTS_KRW || 20),
      llm: Number(process.env.COST_LLM_CONTENT_KRW || 15),
    },
    mockMode: process.env.USE_MOCK_DATA === 'true',
    configuration: { ok: configuration.ok, failures: configuration.failures, warnings: configuration.warnings },
  })
}
