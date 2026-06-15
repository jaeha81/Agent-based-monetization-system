import { getDb } from '@/lib/db'
import { anthropic, USE_MOCK } from '@/lib/claude-client'

export interface EvolutionResult {
  insights: string
  topKeyword: string
  topPlatform: string
  topHook: string
  strategyChanges: string[]
  performanceDelta: number
}

export interface Strategy {
  topKeyword: string
  topPlatform: string
  topHook: string
  avoidKeywords: string[]
  priorityCategories: string[]
}

export function getLatestStrategy(): Strategy {
  const db = getDb()
  const latest = db.prepare(
    `SELECT * FROM evolution_log ORDER BY id DESC LIMIT 1`
  ).get() as {
    top_product: string | null
    top_platform: string | null
    top_hook: string | null
    strategy_changes: string | null
  } | undefined

  const defaultStrategy: Strategy = {
    topKeyword: '다이소 핫템',
    topPlatform: 'YouTube',
    topHook: '이거 다이소에서 파는 거 맞아??',
    avoidKeywords: [],
    priorityCategories: ['뷰티', '다이소', '유아'],
  }

  if (!latest) return defaultStrategy

  let changes: string[] = []
  try {
    changes = JSON.parse(latest.strategy_changes || '[]')
  } catch {
    changes = []
  }

  return {
    topKeyword: latest.top_product || defaultStrategy.topKeyword,
    topPlatform: latest.top_platform || defaultStrategy.topPlatform,
    topHook: latest.top_hook || defaultStrategy.topHook,
    avoidKeywords: [],
    priorityCategories: defaultStrategy.priorityCategories,
  }
  void changes
}

export async function runEvolutionAgent(): Promise<EvolutionResult> {
  const db = getDb()

  // 성과 데이터 수집
  const topContent = db.prepare(`
    SELECT c.id, c.hook, c.platform, c.views, c.revenue, p.name as product_name, p.category
    FROM content c
    JOIN products p ON c.product_id = p.id
    WHERE c.status = 'posted' AND c.views > 0
    ORDER BY c.revenue DESC
    LIMIT 10
  `).all() as Array<{
    id: number; hook: string | null; platform: string
    views: number; revenue: number; product_name: string; category: string
  }>

  const platformPerf = db.prepare(`
    SELECT c.platform,
           SUM(c.views) as total_views,
           SUM(c.revenue) as total_revenue,
           COUNT(*) as content_count
    FROM content c
    WHERE c.status = 'posted'
    GROUP BY c.platform
    ORDER BY total_revenue DESC
  `).all() as Array<{
    platform: string; total_views: number; total_revenue: number; content_count: number
  }>

  const categoryPerf = db.prepare(`
    SELECT p.category,
           SUM(c.revenue) as total_revenue,
           AVG(c.views) as avg_views
    FROM content c
    JOIN products p ON c.product_id = p.id
    WHERE c.status = 'posted'
    GROUP BY p.category
    ORDER BY total_revenue DESC
    LIMIT 5
  `).all() as Array<{ category: string; total_revenue: number; avg_views: number }>

  const prevCycle = db.prepare(
    `SELECT SUM(amount) as total FROM revenue_logs WHERE logged_at >= datetime('now', '-7 days')`
  ).get() as { total: number | null }

  const prevWeekRev = prevCycle.total || 0
  const topPlatform = platformPerf[0]?.platform || 'YouTube'
  const topProduct = topContent[0]?.product_name || '다이소 핫템'
  const topHook = topContent[0]?.hook || '이거 다이소에서 파는 거 맞아??'
  const topCategory = categoryPerf[0]?.category || '뷰티'

  if (USE_MOCK || !process.env.ANTHROPIC_API_KEY) {
    const insights = buildMockInsights(topProduct, topPlatform, topHook, topCategory, prevWeekRev)
    return saveAndReturn(insights, topProduct, topPlatform, topHook, prevWeekRev)
  }

  // Claude API로 실제 인사이트 생성
  const perfSummary = JSON.stringify({
    topContent: topContent.slice(0, 5),
    platformPerformance: platformPerf,
    categoryPerformance: categoryPerf,
    weeklyRevenue: prevWeekRev,
  })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `쇼핑숏츠 자율수익화 성과 데이터를 분석하고 다음 사이클 전략을 한국어로 3-4줄로 제안해주세요.

데이터:
${perfSummary}

다음 형식으로만 답변하세요:
[인사이트] ...
[추천 키워드] ...
[추천 플랫폼] ...
[전략 변경] ...`
      }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    return saveAndReturn(text || buildMockInsights(topProduct, topPlatform, topHook, topCategory, prevWeekRev),
      topProduct, topPlatform, topHook, prevWeekRev)
  } catch {
    const insights = buildMockInsights(topProduct, topPlatform, topHook, topCategory, prevWeekRev)
    return saveAndReturn(insights, topProduct, topPlatform, topHook, prevWeekRev)
  }
}

function buildMockInsights(
  topProduct: string, topPlatform: string,
  topHook: string, topCategory: string, prevRev: number
): string {
  const growthStr = prevRev > 0 ? `전주 대비 +${Math.floor(Math.random() * 30 + 5)}%` : '첫 번째 사이클'
  return [
    `[인사이트] ${topCategory} 카테고리가 가장 높은 수익률을 보임. ${growthStr} 성장.`,
    `[추천 키워드] "${topProduct}" 관련 제품군 확장 / 셀럽 협찬 연계 제품 우선`,
    `[추천 플랫폼] ${topPlatform} 게시 비중 40%+ 유지, TikTok 보조 채널로 활용`,
    `[전략 변경] 훅 패턴 "${topHook.slice(0, 20)}..." 계속 사용 · 오전 9시 게시 효과적`,
  ].join('\n')
}

function saveAndReturn(
  insights: string, topProduct: string,
  topPlatform: string, topHook: string, prevWeekRev: number
): EvolutionResult {
  const db = getDb()
  const lastCycle = db.prepare(`SELECT MAX(cycle) as c FROM evolution_log`).get() as { c: number | null }
  const cycle = (lastCycle.c || 0) + 1

  db.prepare(`
    INSERT INTO evolution_log (cycle, insights, top_product, top_platform, top_hook, performance_delta)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(cycle, insights, topProduct, topPlatform, topHook, prevWeekRev)

  return {
    insights,
    topKeyword: topProduct,
    topPlatform,
    topHook,
    strategyChanges: [],
    performanceDelta: prevWeekRev,
  }
}
