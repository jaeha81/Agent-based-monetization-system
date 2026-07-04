import { query, queryOne, execute } from '@/lib/db'
import { runContentAgent } from './content-agent'
import { runEvolutionAgent, getLatestStrategy } from './evolution-agent'
import { publishScheduledPosts } from '@/lib/automation-engine'
import { searchTrendingProducts, generateAffiliateLink } from '@/lib/coupang'

export type AgentName =
  | 'trend_agent'
  | 'content_agent'
  | 'publish_agent'
  | 'revenue_agent'
  | 'evolution_agent'

export interface OrchestratorResult {
  cycleId: number
  agentResults: Record<AgentName, { status: string; summary: string; revenueAdded: number }>
  totalRevenueAdded: number
  evolutionInsights: string
  nextCycleAt: string
}

async function setAgentState(
  name: AgentName,
  status: string,
  task?: string,
  result?: string,
  revenueAdded = 0
) {
  await execute(`
    UPDATE agent_states
    SET status = ?, current_task = ?, last_result = ?,
        revenue_contributed = revenue_contributed + ?,
        total_runs = CASE WHEN ? = 'completed' THEN total_runs + 1 ELSE total_runs END,
        success_runs = CASE WHEN ? = 'completed' THEN success_runs + 1
                            WHEN ? = 'error' THEN success_runs
                            ELSE success_runs END,
        last_run_at = CASE WHEN ? IN ('completed','error') THEN datetime('now') ELSE last_run_at END,
        updated_at = datetime('now')
    WHERE agent_name = ?
  `, [status, task ?? null, result ?? null, revenueAdded,
    status, status, status, status, name])
}

async function logTask(name: AgentName, type: string, data?: string): Promise<number> {
  const { lastInsertRowid } = await execute(
    `INSERT INTO agent_tasks (agent_name, task_type, task_data, status, started_at)
     VALUES (?, ?, ?, 'running', datetime('now'))`,
    [name, type, data ?? null]
  )
  return lastInsertRowid
}

async function completeTask(taskId: number, result: string, status: 'completed' | 'failed') {
  await execute(
    `UPDATE agent_tasks SET status = ?, result = ?, completed_at = datetime('now') WHERE id = ?`,
    [status, result, taskId]
  )
}

export async function runFullCycle(): Promise<OrchestratorResult> {
  const cycleId = Date.now()
  const results: Record<AgentName, { status: string; summary: string; revenueAdded: number }> = {
    trend_agent: { status: 'skipped', summary: '', revenueAdded: 0 },
    content_agent: { status: 'skipped', summary: '', revenueAdded: 0 },
    publish_agent: { status: 'skipped', summary: '', revenueAdded: 0 },
    revenue_agent: { status: 'skipped', summary: '', revenueAdded: 0 },
    evolution_agent: { status: 'skipped', summary: '', revenueAdded: 0 },
  }

  // ── 1. 진화 에이전트: 이전 사이클 분석 → 전략 갱신 ──
  await setAgentState('evolution_agent', 'running', '이전 사이클 성과 분석 중')
  const evoTaskId = await logTask('evolution_agent', 'analyze_performance')
  let evolutionInsights = '첫 번째 사이클 — 기준선 수집 중'
  try {
    const evoResult = await runEvolutionAgent()
    evolutionInsights = evoResult.insights
    await setAgentState('evolution_agent', 'completed', undefined, evoResult.insights, 0)
    await completeTask(evoTaskId, evoResult.insights, 'completed')
    results.evolution_agent = { status: 'completed', summary: evoResult.insights, revenueAdded: 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await setAgentState('evolution_agent', 'error', undefined, msg)
    await completeTask(evoTaskId, msg, 'failed')
    results.evolution_agent = { status: 'error', summary: msg, revenueAdded: 0 }
  }

  // ── 2. 트렌드 에이전트: 진화 전략 기반 제품 발굴 ──
  const strategy = await getLatestStrategy()
  const keyword = strategy.topKeyword || '트렌드 핫템'
  await setAgentState('trend_agent', 'running', `키워드 탐색: ${keyword}`)
  const trendTaskId = await logTask('trend_agent', 'search_products', keyword)
  const newProductIds: number[] = []

  try {
    const products = await searchTrendingProducts(keyword, 5)
    for (const p of products) {
      const exists = await queryOne<{ id: number }>('SELECT id FROM products WHERE name = ?', [p.productName])
      if (!exists) {
        const aff = await generateAffiliateLink(p.productUrl, p.productId, p.commissionRate)
        const { lastInsertRowid } = await execute(
          `INSERT INTO products (name, category, coupang_url, commission_rate, viral_score, estimated_revenue)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [p.productName, p.categoryName, aff.shortUrl, p.commissionRate,
            0,
            0]
        )
        newProductIds.push(lastInsertRowid)
      }
    }

    // 기존 고성과 제품도 추가
    if (newProductIds.length < 3) {
      const top = await query<{ id: number }>(
        `SELECT id FROM products WHERE approved IS NOT 0 ORDER BY viral_score DESC LIMIT 5`
      )
      newProductIds.push(...top.map(r => r.id).slice(0, 3 - newProductIds.length))
    }

    const summary = `${newProductIds.length}개 제품 발굴 (키워드: ${keyword})`
    await setAgentState('trend_agent', 'completed', undefined, summary)
    await completeTask(trendTaskId, summary, 'completed')
    results.trend_agent = { status: 'completed', summary, revenueAdded: 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await setAgentState('trend_agent', 'error', undefined, msg)
    await completeTask(trendTaskId, msg, 'failed')
    results.trend_agent = { status: 'error', summary: msg, revenueAdded: 0 }
    // fallback: use existing products
    const top = await query<{ id: number }>('SELECT id FROM products WHERE approved IS NOT 0 ORDER BY viral_score DESC LIMIT 3')
    newProductIds.push(...top.map(r => r.id))
  }

  // ── 3. 콘텐츠 에이전트: 발굴된 제품 → 콘텐츠 생성 ──
  await setAgentState('content_agent', 'running', `${newProductIds.length}개 제품 콘텐츠 생성 중`)
  const contentTaskId = await logTask('content_agent', 'generate_content', JSON.stringify(newProductIds))
  let contentGenerated = 0

  try {
    for (const productId of newProductIds.slice(0, 3)) {
      const product = await queryOne<{ id: number; name: string; category: string }>(
        'SELECT id, name, category FROM products WHERE id = ?', [productId]
      )
      if (!product) continue

      const recent = await queryOne<{ c: number }>(
        `SELECT COUNT(*) as c FROM content WHERE product_id = ? AND status IN ('draft','scheduled')`,
        [productId]
      )
      if (recent && recent.c > 0) continue

      await runContentAgent(product.id, product.name, product.category)
      contentGenerated += 6

      // 스케줄 등록
      const contents = await query<{ id: number; platform: string }>(
        `SELECT id, platform FROM content WHERE product_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 6`,
        [productId]
      )

      const pendingRow = await queryOne<{ c: number }>(
        `SELECT COUNT(*) as c FROM scheduled_posts WHERE status = 'pending'`
      )
      const pending = pendingRow?.c ?? 0

      for (let i = 0; i < contents.length; i++) {
        const c = contents[i]
        const hrs = [9, 12, 15, 18, 20, 22]
        const hoursAhead = i + 1
        const scheduled = new Date()
        scheduled.setHours(hrs[i % hrs.length], 0, 0, 0)
        if (scheduled <= new Date()) scheduled.setDate(scheduled.getDate() + Math.floor(pending / 6) + 1)
        await execute(
          `INSERT OR IGNORE INTO scheduled_posts (content_id, platform, scheduled_for) VALUES (?, ?, ?)`,
          [c.id, c.platform, scheduled.toISOString()]
        )
        await execute(`UPDATE content SET status = 'scheduled' WHERE id = ?`, [c.id])
        void hoursAhead
      }
    }

    const summary = `${contentGenerated}개 콘텐츠 생성 및 스케줄 등록`
    await setAgentState('content_agent', 'completed', undefined, summary)
    await completeTask(contentTaskId, summary, 'completed')
    results.content_agent = { status: 'completed', summary, revenueAdded: 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await setAgentState('content_agent', 'error', undefined, msg)
    await completeTask(contentTaskId, msg, 'failed')
    results.content_agent = { status: 'error', summary: msg, revenueAdded: 0 }
  }

  // ── 4. 게시 에이전트: 예약된 콘텐츠 발행 ──
  await setAgentState('publish_agent', 'running', '예약 콘텐츠 발행 중')
  const pubTaskId = await logTask('publish_agent', 'publish_scheduled')
  try {
    const pubResult = await publishScheduledPosts()
    const summary = `${pubResult.succeeded}개 게시 성공, ${pubResult.failed}개 실패`
    await setAgentState('publish_agent', 'completed', undefined, summary)
    await completeTask(pubTaskId, summary, 'completed')
    results.publish_agent = { status: 'completed', summary, revenueAdded: 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await setAgentState('publish_agent', 'error', undefined, msg)
    await completeTask(pubTaskId, msg, 'failed')
    results.publish_agent = { status: 'error', summary: msg, revenueAdded: 0 }
  }

  // ── 5. 수익 에이전트: 실제 DB 수익 집계 (YouTube revenue-sync cron이 실제 조회수 업데이트)
  await setAgentState('revenue_agent', 'running', '수익 현황 집계 중')
  const revTaskId = await logTask('revenue_agent', 'sync_revenue')
  try {
    const postedCount = await queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM content WHERE status = 'posted'`
    )
    const totalRevRow = await queryOne<{ t: number }>(
      `SELECT COALESCE(SUM(amount), 0) as t FROM revenue_logs`
    )
    const totalViews = await queryOne<{ v: number }>(
      `SELECT COALESCE(SUM(views), 0) as v FROM content WHERE status = 'posted'`
    )
    const revenueAdded = 0
    const summary = `게시 콘텐츠 ${postedCount?.c ?? 0}개 | 총 조회수 ${(totalViews?.v ?? 0).toLocaleString()} | 누적 수익 ₩${(totalRevRow?.t ?? 0).toLocaleString()} (쿠팡 수익은 /revenue 페이지에서 수동 입력)`
    await setAgentState('revenue_agent', 'completed', undefined, summary, revenueAdded)
    await completeTask(revTaskId, summary, 'completed')
    results.revenue_agent = { status: 'completed', summary, revenueAdded }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await setAgentState('revenue_agent', 'error', undefined, msg)
    await completeTask(revTaskId, msg, 'failed')
    results.revenue_agent = { status: 'error', summary: msg, revenueAdded: 0 }
  }

  const totalRevenueAdded = Object.values(results).reduce((s, r) => s + r.revenueAdded, 0)
  const nextCycleAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  // 다음 실행 시각 기록
  await execute(`UPDATE agent_states SET next_run_at = ?`, [nextCycleAt])

  return { cycleId, agentResults: results, totalRevenueAdded, evolutionInsights, nextCycleAt }
}

export async function getAgentDashboard() {
  const agents = await query<{
    id: number; agent_name: string; status: string
    current_task: string | null; last_result: string | null
    total_runs: number; success_runs: number
    revenue_contributed: number; last_run_at: string | null; next_run_at: string | null
  }>(`SELECT id, agent_name, status, current_task, last_result, total_runs, success_runs, revenue_contributed, last_run_at, next_run_at FROM agent_states ORDER BY id`)

  const recentTasks = await query<{
    id: number; agent_name: string; task_type: string
    status: string; result: string | null; created_at: string; completed_at: string | null
  }>(`SELECT id, agent_name, task_type, status, result, created_at, completed_at FROM agent_tasks ORDER BY id DESC LIMIT 30`)

  const evolutionHistory = await query<{
    id: number; cycle: number; insights: string | null
    strategy_changes: string | null; top_product: string | null
    top_platform: string | null; performance_delta: number; created_at: string
  }>(`SELECT id, cycle, insights, strategy_changes, top_product, top_platform, performance_delta, created_at FROM evolution_log ORDER BY id DESC LIMIT 5`)

  const revenueAccounts = await query<{
    id: number; account_type: string; account_name: string | null
    bank_name: string | null; account_number_masked: string | null
    is_verified: number; total_received: number
  }>(`SELECT id, account_type, account_name, bank_name, account_number_masked, is_verified, total_received FROM revenue_accounts ORDER BY id`)

  const agentRevenue = await query<{ agent_name: string; total: number }>(
    `SELECT agent_name, SUM(revenue_contributed) as total
     FROM agent_states GROUP BY agent_name`
  )

  return { agents, recentTasks, evolutionHistory, revenueAccounts, agentRevenue }
}
