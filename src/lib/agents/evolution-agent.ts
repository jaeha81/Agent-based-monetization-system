import { query, queryOne, execute } from '@/lib/db'
import { USE_MOCK, generateJSON } from '@/lib/claude-client'

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

export async function getLatestStrategy(): Promise<Strategy> {
  const externalTrend = await queryOne<{ keyword: string }>(`
    SELECT keyword FROM market_trend_keywords
    WHERE collected_at >= datetime('now', '-3 days')
    ORDER BY score DESC LIMIT 1
  `).catch(() => undefined)
  const latest = await queryOne<{
    top_product: string | null
    top_platform: string | null
    top_hook: string | null
    strategy_changes: string | null
  }>(`SELECT top_product, top_platform, top_hook, strategy_changes FROM evolution_log ORDER BY id DESC LIMIT 1`)

  const defaultStrategy: Strategy = {
    topKeyword: externalTrend?.keyword || '다이소 핫템',
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
    topKeyword: latest.top_product || externalTrend?.keyword || defaultStrategy.topKeyword,
    topPlatform: latest.top_platform || defaultStrategy.topPlatform,
    topHook: latest.top_hook || defaultStrategy.topHook,
    avoidKeywords: [],
    priorityCategories: defaultStrategy.priorityCategories,
  }
  void changes
}

export async function runEvolutionAgent(): Promise<EvolutionResult> {
  // 성과 데이터 수집
  const topContent = await query<{
    id: number; hook: string | null; platform: string
    views: number; revenue: number; product_name: string; category: string
    click_count: number; avg_view_percentage: number; performance_score: number
  }>(`
    SELECT c.id, c.hook, c.platform, c.views,
           COALESCE((SELECT SUM(re.amount) FROM revenue_events re WHERE re.content_id = c.id), 0) revenue,
           c.click_count,
           c.avg_view_percentage, c.performance_score,
           p.name as product_name, p.category
    FROM content c
    JOIN products p ON c.product_id = p.id
    WHERE c.views > 0 AND c.metrics_source = 'youtube_api'
    ORDER BY c.performance_score DESC, c.click_count DESC
    LIMIT 10
  `)

  const platformPerf = await query<{
    platform: string; total_views: number; total_revenue: number; content_count: number
  }>(`
    SELECT c.platform,
           SUM(c.views) as total_views,
           COALESCE((SELECT SUM(re.amount) FROM revenue_events re WHERE re.platform = c.platform), 0) as total_revenue,
           COUNT(*) as content_count
    FROM content c
    WHERE c.views > 0 AND c.metrics_source = 'youtube_api'
    GROUP BY c.platform
    ORDER BY total_revenue DESC
  `)

  const categoryPerf = await query<{
    category: string; total_revenue: number; avg_views: number
    avg_retention: number; total_clicks: number; avg_score: number
  }>(`
    SELECT p.category,
           COALESCE((SELECT SUM(px.actual_revenue) FROM products px WHERE px.category = p.category), 0) as total_revenue,
           AVG(c.views) as avg_views,
           AVG(c.avg_view_percentage) as avg_retention,
           SUM(c.click_count) as total_clicks,
           AVG(c.performance_score) as avg_score
    FROM content c
    JOIN products p ON c.product_id = p.id
    WHERE c.views > 0 AND c.metrics_source = 'youtube_api'
    GROUP BY p.category
    ORDER BY avg_score DESC, total_clicks DESC
    LIMIT 5
  `)

  const prevCycle = await queryOne<{ total: number | null }>(
    `SELECT SUM(amount) as total FROM revenue_events WHERE logged_at >= datetime('now', '-7 days')`
  )

  const prevWeekRev = prevCycle?.total || 0
  const topPlatform = platformPerf[0]?.platform || 'YouTube'
  const topProduct = topContent[0]?.product_name || '다이소 핫템'
  const topHook = topContent[0]?.hook || '이거 다이소에서 파는 거 맞아??'
  const topCategory = categoryPerf[0]?.category || '뷰티'

  if (USE_MOCK || !process.env.GEMINI_API_KEY) {
    const insights = buildMockInsights(topProduct, topPlatform, topHook, topCategory, prevWeekRev)
    return saveAndReturn(insights, topProduct, topPlatform, topHook, prevWeekRev)
  }

  const perfSummary = JSON.stringify({
    topContent: topContent.slice(0, 5),
    platformPerformance: platformPerf,
    categoryPerformance: categoryPerf,
    weeklyRevenue: prevWeekRev,
  })

  try {
    const result = await generateJSON<{ insights: string }>(
      '당신은 쇼핑숏츠 수익화 전략 분석가입니다. 성과 데이터를 분석하고 JSON 형식으로만 응답합니다.',
      `쇼핑숏츠 성과 데이터를 분석하고 다음 사이클 전략을 제안해주세요.\n\n데이터:\n${perfSummary}\n\n다음 형식으로 응답:\n{"insights": "[인사이트] ...\\n[추천 키워드] ...\\n[추천 플랫폼] ...\\n[전략 변경] ..."}`
    )
    return saveAndReturn(result.insights || buildMockInsights(topProduct, topPlatform, topHook, topCategory, prevWeekRev),
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
  const growthStr = prevRev > 0 ? `전주 대비 수익 발생` : '첫 번째 사이클'
  return [
    `[인사이트] ${topCategory} 카테고리가 가장 높은 수익률을 보임. ${growthStr} 성장.`,
    `[추천 키워드] "${topProduct}" 관련 제품군 확장 / 셀럽 협찬 연계 제품 우선`,
    `[추천 플랫폼] ${topPlatform} 게시 비중 40%+ 유지, TikTok 보조 채널로 활용`,
    `[전략 변경] 훅 패턴 "${topHook.slice(0, 20)}..." 계속 사용 · 오전 9시 게시 효과적`,
  ].join('\n')
}

async function saveAndReturn(
  insights: string, topProduct: string,
  topPlatform: string, topHook: string, prevWeekRev: number
): Promise<EvolutionResult> {
  const lastCycle = await queryOne<{ c: number | null }>(`SELECT MAX(cycle) as c FROM evolution_log`)
  const cycle = (lastCycle?.c || 0) + 1

  await execute(`
    INSERT INTO evolution_log (cycle, insights, top_product, top_platform, top_hook, performance_delta)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [cycle, insights, topProduct, topPlatform, topHook, prevWeekRev])

  return {
    insights,
    topKeyword: topProduct,
    topPlatform,
    topHook,
    strategyChanges: [],
    performanceDelta: prevWeekRev,
  }
}
