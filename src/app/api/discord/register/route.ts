import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const COMMANDS = [
  { name: '상태', description: '시스템 및 자동화 실행 상태를 확인합니다' },
  { name: '실행', description: '일일 자동화를 수동으로 실행합니다 (제품 탐색 → 콘텐츠 생성 → 스케줄링)' },
  { name: '제품', description: '바이럴 점수 기준 상위 5개 제품을 조회합니다' },
  { name: '수익', description: '수익 현황 (총/월간/오늘)을 조회합니다' },
  { name: '에이전트', description: 'AI 에이전트별 실행 현황을 조회합니다' },
  { name: '도움말', description: '사용 가능한 슬래시 커맨드 목록을 표시합니다' },
]

export async function POST() {
  const appId = process.env.DISCORD_APPLICATION_ID
  const botToken = process.env.DISCORD_BOT_TOKEN
  const guildId = process.env.DISCORD_GUILD_ID

  if (!appId || !botToken) {
    return NextResponse.json(
      { ok: false, error: 'DISCORD_APPLICATION_ID 또는 DISCORD_BOT_TOKEN 환경변수가 없습니다' },
      { status: 500 }
    )
  }

  // Guild-scoped registration (instant) vs global (up to 1h propagation)
  const endpoint = guildId
    ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${appId}/commands`

  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify(COMMANDS),
  })

  const data = await res.json()

  if (!res.ok) {
    console.error('[Discord Register] 실패:', data)
    return NextResponse.json({ ok: false, error: data }, { status: res.status })
  }

  const registered = Array.isArray(data) ? data.map((c: { name: string; id: string }) => ({ name: c.name, id: c.id })) : data
  console.log('[Discord Register] 완료:', registered)
  return NextResponse.json({ ok: true, scope: guildId ? 'guild' : 'global', registered })
}
