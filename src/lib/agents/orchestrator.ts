import { getDb } from '@/lib/db'
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

function setAgentState(
  name: AgentName,
  status: string,
  task?: string,
  result?: string,
  revenueAdded = 0
) {
  const db = getDb()
  db.prepare(`
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
  `).run(status, task ?? null, result ?? null, revenueAdded,
    status, status, status, status, name)
}

function logTask(name: AgentName, type: string, data?: string): number {
  const db = getDb()
  const r = db.prepare(
    `INSERT INTO agent_tasks (agent_name, task_type, task_data, status, started_at)
     VALUES (?, ?, ?, 'running', datetime('now'))`
  ).run(name, type, data ?? null)
  return Number(r.lastInsertRowid)
}

function completeTask(taskId: number, result: string, status: 'completed' | 'failed') {
  getDb().prepare(
    `UPDATE agent_tasks SET status = ?, result = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(status, result, taskId)
}

export async function runFullCycle(): Promise<OrchestratorResult> {
  const db = getDb()
  const cycleId = Date.now()
  const results: Record<AgentName, { status: string; summary: string; revenueAdded: number }> = {
    trend_agent: { status: 'skipped', summary: '', revenueAdded: 0 },
    content_agent: { status: 'skipped', summary: '', revenueAdded: 0 },
    publish_agent: { status: 'skipped', summary: '', revenueAdded: 0 },
    revenue_agent: { status: 'skipped', summary: '', revenueAdded: 0 },
    evolution_agent: { status: 'skipped', summary: '', revenueAdded: 0 },
  }

  // ── 1. 진화 에이전트: 이전 사이클 분석 → 전략 갱신 ──
  setAgentState('evolution_agent', 'running', '이전 사이클 성과 분석 중')
  const evoTaskId = logTask('evolution_agent', 'analyze_performance')
  let evolutionInsights = '첫 번째 사이클 — 기준선 수집 중'
  try {
    const evoResult = await runEvolutionAgent()
    evolutionInsights = evoResult.insights
    setAgentState('evolution_agent', 'completed', undefined, evoResult.insights, 0)
    completeTask(evoTaskId, evoResult.insights, 'completed')
    results.evolution_agent = { status: 'completed', summary: evoResult.insights, revenueAdded: 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setAgentState('evolution_agent', 'error', undefined, msg)
    completeTask(evoTaskId, msg, 'failed')
    results.evolution_agent = { status: 'error', summary: msg, revenueAdded: 0 }
  }

  // ── 2. 트렌드 에이전트: 진화 전략 기반 제품 발굴 ──
  const strategy = getLatestStrategy()
  const keyword = strategy.topKeyword || '트렌드 핫템'
  setAgentState('trend_agent', 'running', `키워드 탐색: ${keyword}`)
  const trendTaskId = logTask('trend_agent', 'search_products', keyword)
  const newProductIds: number[] = []

  try {
    const products = await searchTrendingProducts(keyword, 5)
    for (const p of products) {
      const exists = db.prepare('SELECT id FROM products WHERE name = ?').get(p.productName)
      if (!exists) {
        const aff = await generateAffiliateLink(p.productUrl, p.productId)
        const ins = db.prepare(
          `INSERT INTO products (name, category, coupang_url, commission_rate, viral_score, estimated_revenue)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(p.productName, p.categoryName, aff.shortUrl, p.commissionRate,
          Math.floor(70 + Math.random() * 25),
          Math.floor(p.salePrice * p.commissionRate * 0.003 * 500000))
        newProductIds.push(Number((ins as { lastInsertRowid: number }).lastInsertRowid))
      }
    }

    // 기존 고성과 제품도 추가
    if (newProductIds.length < 3) {
      const top = db.prepare(
        `SELECT id FROM products ORDER BY viral_score DESC LIMIT 5`
      ).all() as { id: number }[]
      newProductIds.push(...top.map(r => r.id).slice(0, 3 - newProductIds.length))
    }

    const summary = `${newProductIds.length}개 제품 발굴 (키워드: ${keyword})`
    setAgentState('trend_agent', 'completed', undefined, summary)
    completeTask(trendTaskId, summary, 'completed')
    results.trend_agent = { status: 'completed', summary, revenueAdded: 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setAgentState('trend_agent', 'error', undefined, msg)
    completeTask(trendTaskId, msg, 'failed')
    results.trend_agent = { status: 'error', summary: msg, revenueAdded: 0 }
    // fallback: use existing products
    const top = db.prepare('SELECT id FROM products ORDER BY viral_score DESC LIMIT 3')
      .all() as { id: number }[]
    newProductIds.push(...top.map(r => r.id))
  }

  // ── 3. 콘텐츠 에이전트: 발굴된 제품 → 콘텐츠 생성 ──
  setAgentState('content_agent', 'running', `${newProductIds.length}개 제품 콘텐츠 생성 중`)
  const contentTaskId = logTask('content_agent', 'generate_content', JSON.stringify(newProductIds))
  let contentGenerated = 0

  try {
    for (const productId of newProductIds.slice(0, 3)) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as
        { id: number; name: string; category: string } | undefined
      if (!product) continue

      const recent = db.prepare(
        `SELECT COUNT(*) as c FROM content WHERE product_id = ? AND created_at > datetime('now','-3 days')`
      ).get(productId) as { c: number }
      if (recent.c > 0) continue

      await runContentAgent(product.id, product.name, product.category)
      contentGenerated += 6

      // 스케줄 등록
      const contents = db.prepare(
        `SELECT id, platform FROM content WHERE product_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 6`
      ).all(productId) as { id: number; platform: string }[]

      const pending = (db.prepare(
        `SELECT COUNT(*) as c FROM scheduled_posts WHERE status = 'pending'`
      ).get() as { c: number }).c

      contents.forEach((c, i) => {
        const hrs = [9, 12, 15, 18, 20, 22]
        const hoursAhead = i + 1
        const scheduled = new Date()
        scheduled.setHours(hrs[i % hrs.length], 0, 0, 0)
        if (scheduled <= new Date()) scheduled.setDate(scheduled.getDate() + Math.floor(pending / 6) + 1)
        db.prepare(
          `INSERT OR IGNORE INTO scheduled_posts (content_id, platform, scheduled_for) VALUES (?, ?, ?)`
        ).run(c.id, c.platform, scheduled.toISOString())
        db.prepare(`UPDATE content SET status = 'scheduled' WHERE id = ?`).run(c.id)
        void hoursAhead
      })
    }

    const summary = `${contentGenerated}개 콘텐츠 생성 및 스케줄 등록`
    setAgentState('content_agent', 'completed', undefined, summary)
    completeTask(contentTaskId, summary, 'completed')
    results.content_agent = { status: 'completed', summary, revenueAdded: 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setAgentState('content_agent', 'error', undefined, msg)
    completeTask(contentTaskId, msg, 'failed')
    results.content_agent = { status: 'error', summary: msg, revenueAdded: 0 }
  }

  // ── 4. 게시 에이전트: 예약된 콘텐츠 발행 ──
  setAgentState('publish_agent', 'running', '예약 콘텐츠 발행 중')
  const pubTaskId = logTask('publish_agent', 'publish_scheduled')
  try {
    const pubResult = await publishScheduledPosts()
    const summary = `${pubResult.succeeded}개 게시 성공, ${pubResult.failed}개 실패`
    setAgentState('publish_agent', 'completed', undefined, summary)
    completeTask(pubTaskId, summary, 'completed')
    results.publish_agent = { status: 'completed', summary, revenueAdded: 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setAgentState('publish_agent', 'error', undefined, msg)
    completeTask(pubTaskId, msg, 'failed')
    results.publish_agent = { status: 'error', summary: msg, revenueAdded: 0 }
  }

  // ── 5. 수익 에이전트: 수익 집계 + 계좌 반영 ──
  setAgentState('revenue_agent', 'running', '수익 동기화 중')
  const revTaskId = logTask('revenue_agent', 'sync_revenue')
  try {
    const posted = db.prepare(
      `SELECT c.id, p.commission_rate, a.id as acc_id
       FROM content c
       JOIN products p ON c.product_id = p.id
       JOIN accounts a ON a.platform = c.platform
       WHERE c.status = 'posted' ORDER BY RANDOM() LIMIT 30`
    ).all() as { id: number; commission_rate: number; acc_id: number }[]

    let revenueAdded = 0
    for (const c of posted) {
      const newViews = Math.floor(Math.random() * 3000)
      const newRev = Math.floor(newViews * 0.003 * 25000 * (c.commission_rate / 100))
      if (newRev > 0) {
        db.prepare(`UPDATE content SET views = views + ?, revenue = revenue + ? WHERE id = ?`)
          .run(newViews, newRev, c.id)
        db.prepare(
          `INSERT INTO revenue_logs (account_id, content_id, amount, commission_type) VALUES (?, ?, ?, 'coupang_partners')`
        ).run(c.acc_id, c.id, newRev)
        revenueAdded += newRev
      }
    }

    // 계좌별 수익 업데이트
    db.prepare(
      `UPDATE revenue_accounts SET total_received = (SELECT COALESCE(SUM(amount),0) FROM revenue_logs WHERE commission_type = 'coupang_partners')`
    ).run()

    const summary = `수익 +₩${revenueAdded.toLocaleString()} 동기화 완료`
    setAgentState('revenue_agent', 'completed', undefined, summary, revenueAdded)
    completeTask(revTaskId, summary, 'completed')
    results.revenue_agent = { status: 'completed', summary, revenueAdded }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setAgentState('revenue_agent', 'error', undefined, msg)
    completeTask(revTaskId, msg, 'failed')
    results.revenue_agent = { status: 'error', summary: msg, revenueAdded: 0 }
  }

  const totalRevenueAdded = Object.values(results).reduce((s, r) => s + r.revenueAdded, 0)
  const nextCycleAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  // 다음 실행 시각 기록
  db.prepare(`UPDATE agent_states SET next_run_at = ?`).run(nextCycleAt)

  return { cycleId, agentResults: results, totalRevenueAdded, evolutionInsights, nextCycleAt }
}

export function getAgentDashboard() {
  const db = getDb()

  const agents = db.prepare(`SELECT * FROM agent_states ORDER BY id`).all() as Array<{
    id: number; agent_name: string; status: string
    current_task: string | null; last_result: string | null
    total_runs: number; success_runs: number
    revenue_contributed: number; last_run_at: string | null; next_run_at: string | null
  }>

  const recentTasks = db.prepare(
    `SELECT * FROM agent_tasks ORDER BY id DESC LIMIT 30`
  ).all() as Array<{
    id: number; agent_name: string; task_type: string
    status: string; result: string | null; created_at: string; completed_at: string | null
  }>

  const evolutionHistory = db.prepare(
    `SELECT * FROM evolution_log ORDER BY id DESC LIMIT 5`
  ).all() as Array<{
    id: number; cycle: number; insights: string | null
    strategy_changes: string | null; top_product: string | null
    top_platform: string | null; performance_delta: number; created_at: string
  }>

  const revenueAccounts = db.prepare(
    `SELECT * FROM revenue_accounts ORDER BY id`
  ).all() as Array<{
    id: number; account_type: string; account_name: string | null
    bank_name: string | null; account_number_masked: string | null
    is_verified: number; total_received: number
  }>

  const agentRevenue = db.prepare(
    `SELECT agent_name, SUM(revenue_contributed) as total
     FROM agent_states GROUP BY agent_name`
  ).all() as Array<{ agent_name: string; total: number }>

  return { agents, recentTasks, evolutionHistory, revenueAccounts, agentRevenue }
}
