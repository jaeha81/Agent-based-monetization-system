import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendDiscordWebhook, makeEmbed, COLORS } from '@/lib/discord'

export const runtime = 'nodejs'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const notifyUrl = process.env.DISCORD_NOTIFY_WEBHOOK
  if (!notifyUrl) return NextResponse.json({ ok: false, reason: 'DISCORD_NOTIFY_WEBHOOK not set' })

  const [
    revenueRow, contentRow, publishedRow,
    topProducts, topPlatforms, failedRow, totalRevenueRow
  ] = await Promise.all([
    query<{ total: number }>(`SELECT COALESCE(SUM(amount), 0) as total FROM revenue_logs WHERE logged_at >= date('now', '-1 days')`),
    query<{ c: number }>(`SELECT COUNT(*) as c FROM content WHERE created_at >= date('now', '-1 days')`),
    query<{ c: number }>(`SELECT COUNT(*) as c FROM scheduled_posts WHERE status = 'published' AND published_at >= date('now', '-1 days')`),
    query<{ name: string; revenue: number }>(`SELECT p.name, SUM(c.revenue) as revenue FROM content c JOIN products p ON c.product_id = p.id WHERE c.posted_at >= date('now', '-1 days') GROUP BY p.id ORDER BY revenue DESC LIMIT 3`),
    query<{ platform: string; revenue: number }>(`SELECT platform, SUM(revenue) as revenue FROM content WHERE posted_at >= date('now', '-1 days') GROUP BY platform ORDER BY revenue DESC LIMIT 3`),
    query<{ c: number }>(`SELECT COUNT(*) as c FROM scheduled_posts WHERE status = 'failed' AND updated_at >= date('now', '-1 days') OR error IS NOT NULL AND scheduled_for >= date('now', '-1 days')`),
    query<{ total: number }>(`SELECT COALESCE(SUM(amount), 0) as total FROM revenue_logs`),
  ])

  const todayRevenue = revenueRow[0]?.total ?? 0
  const contentCount = contentRow[0]?.c ?? 0
  const publishedCount = publishedRow[0]?.c ?? 0
  const failedCount = failedRow[0]?.c ?? 0
  const totalRevenue = totalRevenueRow[0]?.total ?? 0

  const topProductStr = topProducts.length > 0
    ? topProducts.map((p, i) => `${i + 1}. ${p.name.slice(0, 20)} (+₩${p.revenue.toLocaleString()})`).join('\n')
    : '없음'

  const topPlatformStr = topPlatforms.length > 0
    ? topPlatforms.map((p, i) => `${i + 1}. ${p.platform} ₩${p.revenue.toLocaleString()}`).join('\n')
    : '없음'

  const now = new Date()
  const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`

  await sendDiscordWebhook(notifyUrl, '', [
    makeEmbed(
      `📊 일일 수익 리포트 — ${dateStr}`,
      `자동화 수익화 시스템 일일 요약`,
      todayRevenue > 0 ? COLORS.green : COLORS.grey,
      [
        { name: '어제 수익', value: `₩${todayRevenue.toLocaleString()}`, inline: true },
        { name: '누적 총 수익', value: `₩${totalRevenue.toLocaleString()}`, inline: true },
        { name: '​', value: '​', inline: true },
        { name: '어제 생성 콘텐츠', value: `${contentCount}개`, inline: true },
        { name: '게시 완료', value: `${publishedCount}개`, inline: true },
        { name: '게시 실패', value: failedCount > 0 ? `⚠️ ${failedCount}개` : '0개', inline: true },
        { name: '🏆 상위 제품', value: topProductStr },
        { name: '📱 상위 플랫폼', value: topPlatformStr },
      ]
    ),
  ])

  return NextResponse.json({ ok: true, todayRevenue, contentCount, publishedCount })
}
