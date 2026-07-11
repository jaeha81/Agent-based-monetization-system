import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import {
  verifyDiscordSignature,
  makeEmbed,
  followUpInteraction,
  COLORS,
  type DiscordInteraction,
  type DiscordEmbed,
} from '@/lib/discord'
import { getAutomationStatus, runDailyAutomation } from '@/lib/automation-engine'
import { getRevenueSummary } from '@/lib/agents/revenue-agent'
import { getAgentDashboard } from '@/lib/agents/orchestrator'
import { query } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-signature-ed25519') ?? ''
  const timestamp = req.headers.get('x-signature-timestamp') ?? ''
  const rawBody = await req.text()

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 5 * 60) {
    return new NextResponse('Expired request', { status: 401 })
  }

  const publicKey = process.env.SHORTS_DISCORD_PUBLIC_KEY ?? ''
  if (!publicKey || !verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
    return new NextResponse('Invalid signature', { status: 401 })
  }

  const interaction: DiscordInteraction = JSON.parse(rawBody)
  if (process.env.SHORTS_DISCORD_GUILD_ID && interaction.guild_id !== process.env.SHORTS_DISCORD_GUILD_ID) {
    return new NextResponse('Unauthorized guild', { status: 403 })
  }

  // PING — Discord health check
  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 })
  }

  // APPLICATION_COMMAND
  if (interaction.type === 2 && interaction.data) {
    const cmd = interaction.data.name

    if (cmd === '실행') {
      const userId = interaction.member?.user.id || interaction.user?.id || ''
      const allowedUsers = (process.env.SHORTS_DISCORD_ADMIN_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean)
      if (allowedUsers.length === 0 || !allowedUsers.includes(userId)) {
        return NextResponse.json({ type: 4, data: { content: '자동화 실행 권한이 없습니다.', flags: 64 } })
      }
      const token = interaction.token
      const appId = process.env.SHORTS_DISCORD_APPLICATION_ID ?? ''

      waitUntil((async () => {
        try {
          const result = await runDailyAutomation()
          const fields: DiscordEmbed['fields'] = [
            { name: '제품 발견', value: String(result.productsFound), inline: true },
            { name: '콘텐츠 생성', value: String(result.contentGenerated), inline: true },
            { name: '스케줄 등록', value: String(result.scheduled), inline: true },
          ]
          if (result.errors.length > 0) {
            fields.push({ name: '오류', value: result.errors.slice(0, 3).join('\n') })
          }
          await followUpInteraction(appId, token, '', [
            makeEmbed(`✅ 자동화 완료 (실행 ID: ${result.runId})`, '', COLORS.green, fields),
          ])
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          await followUpInteraction(appId, token, `❌ 자동화 실패: ${msg.slice(0, 200)}`)
        }
      })())

      return NextResponse.json({ type: 5 })
    }

    try {
      const embed = await buildEmbed(cmd)
      return NextResponse.json({ type: 4, data: { embeds: [embed] } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({
        type: 4,
        data: { content: `❌ 오류: ${msg.slice(0, 200)}`, flags: 64 },
      })
    }
  }

  return NextResponse.json({ type: 1 })
}

async function buildEmbed(cmd: string): Promise<DiscordEmbed> {
  switch (cmd) {
    case '상태': {
      const s = await getAutomationStatus()
      const last = s.lastRun
      const icon =
        last?.status === 'completed' ? '✅' :
        last?.status === 'failed'    ? '❌' :
        last?.status === 'running'   ? '🔄' : '⏸'
      return makeEmbed('📊 시스템 상태', '', COLORS.blue, [
        {
          name: '마지막 실행',
          value: last ? `${icon} ${last.status} (ID: ${last.id})` : '없음',
          inline: true,
        },
        { name: '오늘 발행', value: String(s.todayPublished), inline: true },
        { name: '대기 포스트', value: String(s.pendingPosts), inline: true },
        ...(s.nextScheduled.length > 0
          ? [{
              name: '다음 예약',
              value: s.nextScheduled
                .slice(0, 3)
                .map(n => `${n.product_name} (${n.platform})`)
                .join('\n'),
            }]
          : []),
      ])
    }

    case '제품': {
      const products = await query<{
        name: string; category: string; viral_score: number; estimated_revenue: number
      }>(
        'SELECT name, category, viral_score, estimated_revenue FROM products ORDER BY viral_score DESC LIMIT 5'
      )
      return makeEmbed(
        '🛍️ 인기 제품 TOP 5',
        products.length === 0 ? '등록된 제품이 없습니다.' : '',
        COLORS.purple,
        products.map((p, i) => ({
          name: `${i + 1}. ${p.name}`,
          value: `${p.category} | 바이럴 ${p.viral_score} | ₩${p.estimated_revenue.toLocaleString()}`,
        }))
      )
    }

    case '수익': {
      const rev = await getRevenueSummary()
      return makeEmbed('💰 수익 현황', '', COLORS.yellow, [
        { name: '총 수익', value: `₩${rev.totalRevenue.toLocaleString()}`, inline: true },
        { name: '월간 수익', value: `₩${rev.monthlyRevenue.toLocaleString()}`, inline: true },
        { name: '오늘 수익', value: `₩${rev.todayRevenue.toLocaleString()}`, inline: true },
        { name: '총 콘텐츠', value: String(rev.totalContent), inline: true },
        { name: '활성 채널', value: String(rev.activeAccounts), inline: true },
        { name: '성장률', value: `${rev.growthRate >= 0 ? '+' : ''}${rev.growthRate}%`, inline: true },
      ])
    }

    case '에이전트': {
      const dash = await getAgentDashboard()
      return makeEmbed(
        '🤖 에이전트 현황',
        dash.agents.length === 0 ? '에이전트 정보 없음' : '',
        COLORS.blue,
        dash.agents.slice(0, 5).map(a => ({
          name: a.agent_name,
          value: `상태: ${a.status} | 성공: ${a.success_runs}/${a.total_runs} | 기여: ₩${a.revenue_contributed.toLocaleString()}`,
        }))
      )
    }

    case '도움말':
      return makeEmbed('❓ 사용 가능한 커맨드', '', COLORS.blue, [
        { name: '/상태', value: '시스템 및 자동화 실행 상태 확인' },
        { name: '/실행', value: '일일 자동화 수동 실행 (제품 탐색 → 콘텐츠 생성 → 스케줄링)' },
        { name: '/제품', value: '바이럴 점수 기준 상위 5개 제품 조회' },
        { name: '/수익', value: '수익 현황 (총/월간/오늘) 조회' },
        { name: '/에이전트', value: 'AI 에이전트별 실행 현황 조회' },
        { name: '/도움말', value: '이 도움말 표시' },
      ])

    default:
      return makeEmbed(`❓ 알 수 없는 커맨드`, `/${cmd} 는 지원하지 않습니다.`, COLORS.red)
  }
}
