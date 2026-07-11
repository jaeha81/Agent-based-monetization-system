import { USE_MOCK, mockDelay } from '@/lib/claude-client'
import { query, queryOne } from '@/lib/db'

export interface RevenueSummary {
  totalRevenue: number
  monthlyRevenue: number
  weeklyRevenue: number
  todayRevenue: number
  totalContent: number
  activeAccounts: number
  topPlatform: string
  growthRate: number
  dailyData: Array<{ date: string; revenue: number; views: number }>
  platformData: Array<{ platform: string; revenue: number; percentage: number }>
  topContent: Array<{
    id: number
    name: string
    platform: string
    views: number
    revenue: number
    status: string
  }>
}

export async function getRevenueSummary(): Promise<RevenueSummary> {
  const now = new Date()

  const todayStr = now.toISOString().slice(0, 10)
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7)
  const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30)

  const totalRevRow = await queryOne<{ t: number }>('SELECT COALESCE(SUM(amount),0) as t FROM revenue_events')
  const totalRev = totalRevRow?.t ?? 0

  const monthRevRow = await queryOne<{ t: number }>('SELECT COALESCE(SUM(amount),0) as t FROM revenue_events WHERE logged_at >= ?', [monthAgo.toISOString()])
  const monthRev = monthRevRow?.t ?? 0

  const weekRevRow = await queryOne<{ t: number }>('SELECT COALESCE(SUM(amount),0) as t FROM revenue_events WHERE logged_at >= ?', [weekAgo.toISOString()])
  const weekRev = weekRevRow?.t ?? 0

  const todayRevRow = await queryOne<{ t: number }>('SELECT COALESCE(SUM(amount),0) as t FROM revenue_events WHERE logged_at LIKE ?', [todayStr + '%'])
  const todayRev = todayRevRow?.t ?? 0

  const totalContentRow = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM content')
  const totalContent = totalContentRow?.c ?? 0

  const activeAccountsRow = await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM accounts WHERE status = 'active'")
  const activeAccounts = activeAccountsRow?.c ?? 0

  const dailyRows = await query<{ date: string; revenue: number }>(`
    SELECT DATE(logged_at) as date, SUM(amount) as revenue
    FROM revenue_events
    WHERE logged_at >= ?
    GROUP BY DATE(logged_at)
    ORDER BY date
  `, [monthAgo.toISOString()])

  const dailyData = dailyRows.map(r => ({
    date: r.date,
    revenue: r.revenue,
    views: 0,
  }))

  const platformRows = await query<{ platform: string; revenue: number }>(`
    SELECT platform, SUM(amount) as revenue
    FROM revenue_events
    GROUP BY platform
    ORDER BY revenue DESC
  `)

  const platformTotal = platformRows.reduce((s, r) => s + r.revenue, 0)
  const platformData = platformRows.map(r => ({
    platform: r.platform,
    revenue: r.revenue,
    percentage: platformTotal > 0 ? Math.round((r.revenue / platformTotal) * 100) : 0,
  }))

  const topPlatform = platformData[0]?.platform || 'YouTube'

  const topContentRows = await query<{ id: number; name: string; platform: string; views: number; revenue: number; status: string }>(`
    SELECT c.id, p.name, c.platform, c.views, COALESCE(SUM(re.amount), 0) revenue, c.status
    FROM content c
    JOIN products p ON c.product_id = p.id
    LEFT JOIN revenue_events re ON re.content_id = c.id
    GROUP BY c.id
    ORDER BY revenue DESC
    LIMIT 10
  `)

  const prevMonthRevRow = await queryOne<{ t: number }>(
    'SELECT COALESCE(SUM(amount),0) as t FROM revenue_events WHERE logged_at >= ? AND logged_at < ?',
    [new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(), monthAgo.toISOString()]
  )
  const prevMonthRev = prevMonthRevRow?.t ?? 0

  const growthRate = prevMonthRev > 0 ? Math.round(((monthRev - prevMonthRev) / prevMonthRev) * 100) : 0

  return {
    totalRevenue: totalRev,
    monthlyRevenue: monthRev,
    weeklyRevenue: weekRev,
    todayRevenue: todayRev,
    totalContent,
    activeAccounts,
    topPlatform,
    growthRate,
    dailyData,
    platformData,
    topContent: topContentRows,
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function runRevenueAgent(_prompt: string) {
  if (USE_MOCK) {
    await mockDelay(800)
    const summary = await getRevenueSummary()
    return {
      text: `## 수익 분석 결과\n\n- 이번 달 수익: **${summary.monthlyRevenue.toLocaleString()}원**\n- 상위 플랫폼: **${summary.topPlatform}**\n- 성장률: **${summary.growthRate > 0 ? '+' : ''}${summary.growthRate}%**\n\n**추천**: 뷰티 카테고리 셀럽 협찬 제품 비중을 늘리면 수익이 30% 이상 증가할 것으로 예측됩니다.`,
      summary,
    }
  }

  const summary = await getRevenueSummary()
  return { text: '수익 데이터 조회 완료', summary }
}
