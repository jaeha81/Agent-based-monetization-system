import { execute, query } from '@/lib/db'

export interface ProductDecisionInput {
  views: number
  clicks: number
  retention: number
  performanceScore: number
  profitScore: number
  viralScore: number
  marketTrendScore: number
  revenue: number
  cost: number
  daysSinceFirstPublished: number
  clickSignalReliable: boolean
  revenueDataComplete: boolean
}

export interface ProductDecision {
  score: number
  confidence: number
  action: 'scale' | 'learn' | 'hold' | 'stop'
  reason: string
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))

export function calculateProductDecision(input: ProductDecisionInput): ProductDecision {
  const views = Math.max(0, input.views)
  const confidence = clamp(Math.sqrt(views / 500), 0, 1)
  const smoothedCtr = (Math.max(0, input.clicks) + 2) / (views + 200) * 100
  const ctrScore = clamp(smoothedCtr * 12.5)
  const retentionScore = clamp(input.retention)
  const profitSignal = input.cost > 0 ? clamp(50 + input.profitScore / 2) : 50
  const provenScore = input.clickSignalReliable
    ? retentionScore * 0.35 + ctrScore * 0.25 + profitSignal * 0.40
    : retentionScore * 0.45 + profitSignal * 0.55
  const priorScore = clamp(input.viralScore) * 0.45 + clamp(input.marketTrendScore) * 0.40 + 15
  const score = Math.round((provenScore * confidence + priorScore * (1 - confidence)) * 100) / 100

  let action: ProductDecision['action'] = 'hold'
  const attributionMature = input.daysSinceFirstPublished >= 14
  if (views >= 500 && input.cost > 0 && input.profitScore < -20 && attributionMature && input.revenueDataComplete) action = 'stop'
  else if (views >= 300 && score >= 65 && (input.revenue > 0 || input.profitScore >= 0)) action = 'scale'
  else if (views < 300) action = 'learn'

  const reason = action === 'stop'
    ? `표본 ${views}회에서 ROI ${input.profitScore.toFixed(1)}%로 손실 기준 초과`
    : action === 'scale'
      ? input.clickSignalReliable
        ? `신뢰도 ${(confidence * 100).toFixed(0)}%, 유지율 ${retentionScore.toFixed(1)}%, 보정 CTR ${smoothedCtr.toFixed(2)}%`
        : `신뢰도 ${(confidence * 100).toFixed(0)}%, 유지율 ${retentionScore.toFixed(1)}%, 수익 신호 기반 (CTR 제외)`
      : attributionMature && !input.revenueDataComplete && input.cost > 0 && input.revenue <= 0
        ? '정산 명세 완결일 미확인: 자동 중단 보류'
      : !attributionMature && input.cost > 0 && input.revenue <= 0
        ? `정산 대기 D${Math.max(0, input.daysSinceFirstPublished)}/14: 조기 손실판정 보류`
      : action === 'learn'
        ? `표본 ${views}/300회: 바이럴 ${clamp(input.viralScore).toFixed(1)}, 시장연관 ${clamp(input.marketTrendScore).toFixed(1)}`
        : `점수 ${score.toFixed(1)}: 확대·중단 기준 사이에서 관찰`
  return { score, confidence, action, reason }
}

export async function refreshProductDecisions(): Promise<void> {
  const products = await query<{
    id: number; total_views: number; total_clicks: number; avg_retention: number
    performance_score: number; profit_score: number; viral_score: number; market_trend_score: number
    actual_revenue: number; total_cost: number; days_since_first_published: number; revenue_data_complete: number
  }>(`SELECT id, total_engaged_views AS total_views, total_clicks, avg_retention, performance_score, profit_score,
             viral_score, market_trend_score, actual_revenue, total_cost,
             COALESCE((SELECT CAST(julianday('now') - julianday(MIN(sp.published_at)) AS INTEGER)
                       FROM scheduled_posts sp JOIN content c ON c.id = sp.content_id
                       WHERE c.product_id = products.id AND sp.status = 'published' AND sp.published_at IS NOT NULL), 0)
               AS days_since_first_published,
             CASE WHEN products.revenue_data_complete_through IS NOT NULL AND
               products.revenue_data_complete_through >= COALESCE((SELECT date(MIN(sp.published_at), '+14 days')
                 FROM scheduled_posts sp JOIN content c ON c.id = sp.content_id
                 WHERE c.product_id = products.id AND sp.status = 'published' AND sp.published_at IS NOT NULL), '9999-12-31')
               THEN 1 ELSE 0 END AS revenue_data_complete
      FROM products`)
  for (const product of products) {
    const decision = calculateProductDecision({
      views: Number(product.total_views || 0), clicks: Number(product.total_clicks || 0),
      retention: Number(product.avg_retention || 0), performanceScore: Number(product.performance_score || 0),
      profitScore: Number(product.profit_score || 0), viralScore: Number(product.viral_score || 0),
      marketTrendScore: Number(product.market_trend_score || 0),
      revenue: Number(product.actual_revenue || 0), cost: Number(product.total_cost || 0),
      daysSinceFirstPublished: Number(product.days_since_first_published || 0),
      clickSignalReliable: process.env.YOUTUBE_CLICKABLE_COMMERCE_ENABLED === 'true',
      revenueDataComplete: product.revenue_data_complete === 1,
    })
    await execute(
      `UPDATE products SET selection_score = ?, decision_confidence = ?, decision_action = ?,
       decision_reason = ?, decision_updated_at = datetime('now') WHERE id = ?`,
      [decision.score, decision.confidence, decision.action, decision.reason, product.id]
    )
  }
}

export async function selectProductCandidates(market: string, limit: number, seed: string): Promise<number[]> {
  const candidates = await query<{ id: number }>(`
    SELECT id FROM products
    WHERE target_market = ? AND approved IS NOT 0 AND COALESCE(decision_action, 'learn') != 'stop'
    ORDER BY CASE COALESCE(decision_action, 'learn') WHEN 'scale' THEN 0 WHEN 'learn' THEN 1 ELSE 2 END,
             selection_score DESC, total_engaged_views DESC, created_at DESC LIMIT 30
  `, [market])
  const assignmentKey = `product:${market}:${seed}`
  if (candidates.length <= limit) {
    const ids = candidates.map(item => item.id)
    for (const id of ids) await recordAssignment(assignmentKey, id, 'eligible', 1, { market, candidateCount: candidates.length })
    return ids
  }
  const hash = seed.split('').reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)
  const exploreCount = limit >= 3 ? Math.max(1, Math.round(limit * 0.2)) : 0
  const exploitCount = Math.max(1, limit - exploreCount)
  const selected = candidates.slice(0, exploitCount).map(item => item.id)
  const pool = candidates.slice(exploitCount)
  while (selected.length < limit && pool.length) {
    const index = (hash + selected.length * 17) % pool.length
    selected.push(pool.splice(index, 1)[0].id)
  }
  for (let index = 0; index < selected.length; index++) {
    const arm = index < exploitCount ? 'exploit' : 'explore'
    const propensity = arm === 'exploit' ? 0.8 : 0.2 / Math.max(1, candidates.length - exploitCount)
    await recordAssignment(assignmentKey, selected[index], arm, propensity, { market, candidateCount: candidates.length })
  }
  return selected
}

async function recordAssignment(
  assignmentKey: string, productId: number, arm: string, propensity: number, context: Record<string, unknown>
): Promise<void> {
  await execute(
    `INSERT OR IGNORE INTO experiment_assignments
     (assignment_key, entity_type, entity_id, arm, policy_version, propensity, context_json, outcome_window_end)
     VALUES (?, 'product', ?, ?, 'product-v2', ?, ?, datetime('now', '+7 days'))`,
    [assignmentKey, String(productId), arm, propensity, JSON.stringify(context)]
  )
}
