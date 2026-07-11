import { NextRequest, NextResponse } from 'next/server'
import { sendDiscordWebhook, makeEmbed, COLORS } from '@/lib/discord'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'

const CHANNEL_NAME = '쇼츠-자동화'
const WEBHOOK_NAME = '쇼츠자동화봇'
const CHANNEL_TOPIC = '🤖 쇼핑 숏츠 자동화 시스템 — 알림·리포트·커맨드 채널'

interface DiscordChannel {
  id: string
  name: string
  type: number
}

interface DiscordWebhook {
  id: string
  token: string
}

async function botFetch(path: string, options: RequestInit = {}) {
  const token = process.env.SHORTS_DISCORD_BOT_TOKEN
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
      ...(options.headers as Record<string, string>),
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Discord API ${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}

export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const botToken = process.env.SHORTS_DISCORD_BOT_TOKEN
  const guildId = process.env.SHORTS_DISCORD_GUILD_ID

  if (!botToken || !guildId) {
    return NextResponse.json(
      { ok: false, error: 'SHORTS_DISCORD_BOT_TOKEN 또는 SHORTS_DISCORD_GUILD_ID 환경변수가 없습니다' },
      { status: 500 }
    )
  }

  // 기존 채널 목록 조회 — 이미 존재하면 재생성하지 않음
  const channels: DiscordChannel[] = await botFetch(`/guilds/${guildId}/channels`)
  let channel = channels.find(c => c.type === 0 && c.name === CHANNEL_NAME)

  let channelCreated = false
  if (!channel) {
    channel = await botFetch(`/guilds/${guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name: CHANNEL_NAME, type: 0, topic: CHANNEL_TOPIC }),
    })
    channelCreated = true
  }
  if (!channel) {
    return NextResponse.json({ ok: false, error: '채널 생성 실패' }, { status: 500 })
  }

  // 채널 웹훅 생성 (항상 새로 생성 — 이전 웹훅 덮어쓰기 방지를 위해 기존 목록 확인)
  const existingWebhooks: DiscordWebhook[] = await botFetch(`/channels/${channel.id}/webhooks`)
  let webhookUrl: string

  const existing = existingWebhooks.find(w => w.token)
  if (existing) {
    webhookUrl = `https://discord.com/api/webhooks/${existing.id}/${existing.token}`
  } else {
    const webhook: DiscordWebhook = await botFetch(`/channels/${channel.id}/webhooks`, {
      method: 'POST',
      body: JSON.stringify({ name: WEBHOOK_NAME }),
    })
    webhookUrl = `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}`
  }

  // 설정 완료 알림 메시지 전송
  await sendDiscordWebhook(webhookUrl, '', [
    makeEmbed(
      '✅ 쇼츠자동화 채널 연동 완료',
      `이 채널에서 쇼핑 숏츠 자동화 대시보드와 소통합니다.\n슬래시 커맨드 등록 후 \`/도움말\` 로 사용 가능한 커맨드를 확인하세요.`,
      COLORS.green,
      [
        { name: '채널', value: `#${CHANNEL_NAME}`, inline: true },
        { name: '상태', value: channelCreated ? '신규 생성' : '기존 채널 연결', inline: true },
      ]
    ),
  ])

  return NextResponse.json({
    ok: true,
    channelId: channel.id,
    channelName: CHANNEL_NAME,
    channelCreated,
    webhookUrl,
    next: [
      `1. .env.local 에 SHORTS_DISCORD_WEBHOOK=${webhookUrl} 추가`,
      '2. POST /api/discord/register 호출하여 슬래시 커맨드 등록',
      '3. discord.com/developers 에서 Interactions Endpoint URL 설정',
    ],
  })
}
