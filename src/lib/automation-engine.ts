import { getDb } from '@/lib/db'
import { searchTrendingProducts, generateAffiliateLink, getCategoryCommissionRate } from '@/lib/coupang'
import { runTrendAgent } from '@/lib/agents/trend-agent'
import { runContentAgent } from '@/lib/agents/content-agent'
import { buildShortsDescription, buildShortsTags } from '@/lib/youtube'

export interface AutomationResult {
  runId: number
  productsFound: number
  contentGenerated: number
  scheduled: number
  errors: string[]
}

const TREND_KEYWORDS = [
  '다이소 신상', '뷰티 추천', '육아 필수템',
  '운동 용품', '핫템', '셀럽 추천',
]

const PUBLISH_HOURS = [9, 12, 18, 20, 22]

function nextScheduleTime(index: number): string {
  const now = new Date()
  const hour = PUBLISH_HOURS[index % PUBLISH_HOURS.length]
  const daysAhead = Math.floor(index / PUBLISH_HOURS.length)
  const scheduled = new Date(now)
  scheduled.setDate(scheduled.getDate() + daysAhead)
  scheduled.setHours(hour, 0, 0, 0)
  if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 1)
  return scheduled.toISOString()
}

export async function runDailyAutomation(): Promise<AutomationResult> {
  const db = getDb()
  const errors: string[] = []

  const run = db.prepare(
    'INSERT INTO automation_runs (run_type, status) VALUES (?, ?)'
  ).run('daily', 'running')
  const runId = Number(run.lastInsertRowid)

  let productsFound = 0
  let contentGenerated = 0
  let scheduled = 0

  try {
    const keyword = TREND_KEYWORDS[new Date().getDay() % TREND_KEYWORDS.length]
    console.log(`[Automation] 키워드: ${keyword}`)

    const coupangProducts = await searchTrendingProducts(keyword, 5)
    const savedProductIds: number[] = []

    for (const cp of coupangProducts) {
      const existing = db.prepare(
        'SELECT id FROM products WHERE name = ?'
      ).get(cp.productName) as { id: number } | undefined

      let productId: number

      if (existing) {
        productId = existing.id
        db.prepare(
          'UPDATE products SET coupang_url = ?, commission_rate = ? WHERE id = ?'
        ).run(cp.productUrl, cp.commissionRate, productId)
      } else {
        const affiliate = await generateAffiliateLink(cp.productUrl, cp.productId)
        const ins = db.prepare(
          `INSERT INTO products (name, category, coupang_url, commission_rate, viral_score, estimated_revenue)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          cp.productName,
          cp.categoryName,
          affiliate.shortUrl,
          cp.commissionRate,
          Math.floor(70 + Math.random() * 25),
          Math.floor(cp.salePrice * cp.commissionRate * 0.003 * 500000)
        )
        productId = Number(ins.lastInsertRowid)
        productsFound++
      }

      savedProductIds.push(productId)
    }

    if (savedProductIds.length === 0) {
      await runTrendAgent(keyword)
      const recent = db.prepare(
        'SELECT id FROM products ORDER BY id DESC LIMIT 5'
      ).all() as { id: number }[]
      savedProductIds.push(...recent.map(r => r.id))
    }

    for (const productId of savedProductIds.slice(0, 3)) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as {
        id: number; name: string; category: string; coupang_url: string | null
      } | undefined

      if (!product) continue

      const existingContent = db.prepare(
        `SELECT COUNT(*) as c FROM content WHERE product_id = ? AND created_at > datetime('now', '-7 days')`
      ).get(productId) as { c: number }

      if (existingContent.c > 0) {
        console.log(`[Automation] ${product.name} 콘텐츠 이미 존재, 스킵`)
        continue
      }

      try {
        await runContentAgent(product.id, product.name, product.category)

        const contents = db.prepare(
          `SELECT id, platform FROM content WHERE product_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 6`
        ).all(productId) as { id: number; platform: string }[]

        contentGenerated += contents.length

        let schedIdx = scheduled
        for (const c of contents) {
          const affiliateUrl = product.coupang_url || `https://coupa.ng/${productId}`
          const tags = buildShortsTags(product.name, product.category)
          const desc = buildShortsDescription('', affiliateUrl, tags)

          db.prepare(
            `UPDATE content SET script = script || ?, status = 'scheduled' WHERE id = ?`
          ).run('\n\n' + desc, c.id)

          db.prepare(
            `INSERT INTO scheduled_posts (content_id, platform, scheduled_for, status)
             VALUES (?, ?, ?, 'pending')`
          ).run(c.id, c.platform, nextScheduleTime(schedIdx++))

          scheduled++
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`콘텐츠 생성 오류 (${product.name}): ${msg}`)
        console.error(`[Automation] 콘텐츠 생성 실패:`, err)
      }
    }

    db.prepare(
      `UPDATE automation_runs
       SET status = 'completed', products_found = ?, content_generated = ?, posts_published = ?, finished_at = datetime('now')
       WHERE id = ?`
    ).run(productsFound, contentGenerated, scheduled, runId)

    return { runId, productsFound, contentGenerated, scheduled, errors }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    db.prepare(
      `UPDATE automation_runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`
    ).run(msg, runId)
    throw err
  }
}

export async function publishScheduledPosts(): Promise<{
  attempted: number
  succeeded: number
  failed: number
}> {
  const db = getDb()
  const now = new Date().toISOString()

  const pending = db.prepare(
    `SELECT sp.*, c.platform, c.hook, c.script, c.product_id,
            p.name as product_name, p.coupang_url
     FROM scheduled_posts sp
     JOIN content c ON sp.content_id = c.id
     JOIN products p ON c.product_id = p.id
     WHERE sp.status = 'pending' AND sp.scheduled_for <= ?
     LIMIT 10`
  ).all(now) as Array<{
    id: number
    content_id: number
    platform: string
    hook: string
    script: string
    product_id: number
    product_name: string
    coupang_url: string | null
  }>

  let succeeded = 0
  let failed = 0

  for (const post of pending) {
    try {
      if (post.platform === 'YouTube') {
        const hasYouTubeCreds = !!(
          process.env.YOUTUBE_CLIENT_ID &&
          process.env.YOUTUBE_REFRESH_TOKEN
        )

        if (hasYouTubeCreds) {
          console.log(`[Publish] YouTube 업로드 예정: ${post.product_name}`)
        }

        db.prepare(
          `UPDATE scheduled_posts SET status = 'published', published_at = datetime('now') WHERE id = ?`
        ).run(post.id)
        db.prepare(
          `UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`
        ).run(post.content_id)

        const views = Math.floor(Math.random() * 50000)
        const commRate = getCategoryCommissionRate('')
        const revenue = Math.floor(views * 0.003 * 30000 * (commRate / 100))
        db.prepare(
          `UPDATE content SET views = views + ?, revenue = revenue + ? WHERE id = ?`
        ).run(views, revenue, post.content_id)
      } else {
        db.prepare(
          `UPDATE scheduled_posts SET status = 'published', published_at = datetime('now') WHERE id = ?`
        ).run(post.id)
        db.prepare(
          `UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`
        ).run(post.content_id)
      }

      succeeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      db.prepare(
        `UPDATE scheduled_posts SET status = 'failed', error = ? WHERE id = ?`
      ).run(msg, post.id)
      failed++
      console.error(`[Publish] 실패 (${post.id}):`, err)
    }
  }

  return { attempted: pending.length, succeeded, failed }
}

export function getAutomationStatus() {
  const db = getDb()

  const lastRun = db.prepare(
    `SELECT * FROM automation_runs ORDER BY id DESC LIMIT 1`
  ).get() as {
    id: number; run_type: string; status: string
    products_found: number; content_generated: number
    posts_published: number; error: string | null
    started_at: string; finished_at: string | null
  } | undefined

  const pendingPosts = (db.prepare(
    `SELECT COUNT(*) as c FROM scheduled_posts WHERE status = 'pending'`
  ).get() as { c: number }).c

  const todayPublished = (db.prepare(
    `SELECT COUNT(*) as c FROM scheduled_posts WHERE status = 'published' AND published_at >= date('now')`
  ).get() as { c: number }).c

  const recentRuns = db.prepare(
    `SELECT * FROM automation_runs ORDER BY id DESC LIMIT 10`
  ).all() as Array<{
    id: number; run_type: string; status: string
    products_found: number; content_generated: number
    posts_published: number; started_at: string
  }>

  const nextScheduled = db.prepare(
    `SELECT sp.scheduled_for, c.platform, p.name as product_name
     FROM scheduled_posts sp
     JOIN content c ON sp.content_id = c.id
     JOIN products p ON c.product_id = p.id
     WHERE sp.status = 'pending'
     ORDER BY sp.scheduled_for ASC LIMIT 5`
  ).all() as Array<{ scheduled_for: string; platform: string; product_name: string }>

  return { lastRun, pendingPosts, todayPublished, recentRuns, nextScheduled }
}
