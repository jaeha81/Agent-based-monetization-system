import { USE_MOCK, mockDelay } from '@/lib/claude-client'
import { getDb } from '@/lib/db'

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

export function getRevenueSummary(): RevenueSummary {
  const db = getDb()
  const now = new Date()

  const todayStr = now.toISOString().slice(0, 10)
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7)
  const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30)

  const totalRev = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM revenue_logs').get() as { t: number }).t
  const monthRev = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM revenue_logs WHERE logged_at >= ?').get(monthAgo.toISOString()) as { t: number }).t
  const weekRev = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM revenue_logs WHERE logged_at >= ?').get(weekAgo.toISOString()) as { t: number }).t
  const todayRev = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM revenue_logs WHERE logged_at LIKE ?").get(todayStr + '%') as { t: number }).t

  const totalContent = (db.prepare('SELECT COUNT(*) as c FROM content').get() as { c: number }).c
  const activeAccounts = (db.prepare("SELECT COUNT(*) as c FROM accounts WHERE status = 'active'").get() as { c: number }).c

  const dailyRows = db.prepare(`
    SELECT DATE(logged_at) as date, SUM(amount) as revenue
    FROM revenue_logs
    WHERE logged_at >= ?
    GROUP BY DATE(logged_at)
    ORDER BY date
  `).all(monthAgo.toISOString()) as Array<{ date: string; revenue: number }>

  const dailyData = dailyRows.map(r => ({
    date: r.date,
    revenue: r.revenue,
    views: Math.floor(r.revenue * 8 + Math.random() * 10000),
  }))

  const platformRows = db.prepare(`
    SELECT a.platform, SUM(rl.amount) as revenue
    FROM revenue_logs rl
    JOIN accounts a ON rl.account_id = a.id
    GROUP BY a.platform
    ORDER BY revenue DESC
  `).all() as Array<{ platform: string; revenue: number }>

  const platformTotal = platformRows.reduce((s, r) => s + r.revenue, 0)
  const platformData = platformRows.map(r => ({
    platform: r.platform,
    revenue: r.revenue,
    percentage: platformTotal > 0 ? Math.round((r.revenue / platformTotal) * 100) : 0,
  }))

  const topPlatform = platformData[0]?.platform || 'YouTube'

  const topContentRows = db.prepare(`
    SELECT c.id, p.name, c.platform, c.views, c.revenue, c.status
    FROM content c
    JOIN products p ON c.product_id = p.id
    WHERE c.status = 'posted'
    ORDER BY c.revenue DESC
    LIMIT 10
  `).all() as Array<{ id: number; name: string; platform: string; views: number; revenue: number; status: string }>

  const prevMonthRev = (db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM revenue_logs WHERE logged_at >= ? AND logged_at < ?')
    .get(new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(), monthAgo.toISOString()) as { t: number }).t

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
    const summary = getRevenueSummary()
    return {
      text: `## 수익 분석 결과\n\n- 이번 달 수익: **${summary.monthlyRevenue.toLocaleString()}원**\n- 상위 플랫폼: **${summary.topPlatform}**\n- 성장률: **${summary.growthRate > 0 ? '+' : ''}${summary.growthRate}%**\n\n**추천**: 뷰티 카테고리 셀럽 협찬 제품 비중을 늘리면 수익이 30% 이상 증가할 것으로 예측됩니다.`,
      summary,
    }
  }

  const summary = getRevenueSummary()
  return { text: '수익 데이터 조회 완료', summary }
}
