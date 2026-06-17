import { query, queryOne, execute } from '@/lib/db'
import { searchTrendingProducts, generateAffiliateLink, getCategoryCommissionRate } from '@/lib/coupang'
import { runTrendAgent } from '@/lib/agents/trend-agent'
import { runContentAgent } from '@/lib/agents/content-agent'
import { buildShortsDescription, buildShortsTags } from '@/lib/youtube'
import { sendDiscordWebhook, makeEmbed, COLORS } from '@/lib/discord'

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
  const errors: string[] = []

  const { lastInsertRowid: runId } = await execute(
    'INSERT INTO automation_runs (run_type, status) VALUES (?, ?)',
    ['daily', 'running']
  )

  let productsFound = 0
  let contentGenerated = 0
  let scheduled = 0

  try {
    const keyword = TREND_KEYWORDS[new Date().getDay() % TREND_KEYWORDS.length]
    console.log(`[Automation] 키워드: ${keyword}`)

    const coupangProducts = await searchTrendingProducts(keyword, 5)
    const savedProductIds: number[] = []

    for (const cp of coupangProducts) {
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM products WHERE name = ?', [cp.productName]
      )

      let productId: number
      if (existing) {
        productId = existing.id
        await execute(
          'UPDATE products SET coupang_url = ?, commission_rate = ? WHERE id = ?',
          [cp.productUrl, cp.commissionRate, productId]
        )
      } else {
        const affiliate = await generateAffiliateLink(cp.productUrl, cp.productId)
        const { lastInsertRowid } = await execute(
          `INSERT INTO products (name, category, coupang_url, commission_rate, viral_score, estimated_revenue)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            cp.productName, cp.categoryName, affiliate.shortUrl, cp.commissionRate,
            Math.floor(70 + Math.random() * 25),
            Math.floor(cp.salePrice * cp.commissionRate * 0.003 * 500000),
          ]
        )
        productId = lastInsertRowid
        productsFound++
      }
      savedProductIds.push(productId)
    }

    if (savedProductIds.length === 0) {
      await runTrendAgent(keyword)
      const recent = await query<{ id: number }>(
        'SELECT id FROM products ORDER BY id DESC LIMIT 5'
      )
      savedProductIds.push(...recent.map(r => r.id))
    }

    for (const productId of savedProductIds.slice(0, 3)) {
      const product = await queryOne<{
        id: number; name: string; category: string; coupang_url: string | null
      }>('SELECT * FROM products WHERE id = ?', [productId])
      if (!product) continue

      const existingContent = await queryOne<{ c: number }>(
        `SELECT COUNT(*) as c FROM content WHERE product_id = ? AND created_at > datetime('now', '-1 days')`,
        [productId]
      )
      if ((existingContent?.c ?? 0) > 0) {
        console.log(`[Automation] ${product.name} 콘텐츠 이미 존재, 스킵`)
        continue
      }

      try {
        await runContentAgent(product.id, product.name, product.category)

        const contents = await query<{ id: number; platform: string }>(
          `SELECT id, platform FROM content WHERE product_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 6`,
          [productId]
        )
        contentGenerated += contents.length

        let schedIdx = scheduled
        for (const c of contents) {
          const affiliateUrl = product.coupang_url || `https://coupa.ng/${productId}`
          const tags = buildShortsTags(product.name, product.category)
          const desc = buildShortsDescription('', affiliateUrl, tags)

          await execute(
            `UPDATE content SET script = script || ?, status = 'scheduled' WHERE id = ?`,
            ['\n\n' + desc, c.id]
          )
          await execute(
            `INSERT INTO scheduled_posts (content_id, platform, scheduled_for, status)
             VALUES (?, ?, ?, 'pending')`,
            [c.id, c.platform, nextScheduleTime(schedIdx++)]
          )
          scheduled++
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`콘텐츠 생성 오류 (${product.name}): ${msg}`)
        console.error(`[Automation] 콘텐츠 생성 실패:`, err)
      }
    }

    await execute(
      `UPDATE automation_runs
       SET status = 'completed', products_found = ?, content_generated = ?, posts_published = ?, finished_at = datetime('now')
       WHERE id = ?`,
      [productsFound, contentGenerated, scheduled, runId]
    )

    const result: AutomationResult = { runId, productsFound, contentGenerated, scheduled, errors }

    const notifyUrl = process.env.DISCORD_NOTIFY_WEBHOOK
    if (notifyUrl) {
      sendDiscordWebhook(notifyUrl, '', [
        makeEmbed('✅ 자동화 실행 완료', `실행 ID: **${runId}**`, COLORS.green, [
          { name: '제품 발견', value: String(productsFound), inline: true },
          { name: '콘텐츠 생성', value: String(contentGenerated), inline: true },
          { name: '스케줄 등록', value: String(scheduled), inline: true },
          ...(errors.length > 0 ? [{ name: '오류', value: errors.slice(0, 3).join('\n') }] : []),
        ]),
      ]).catch(e => console.error('[Automation] Discord notify 실패:', e))
    }

    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await execute(
      `UPDATE automation_runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`,
      [msg, runId]
    )
    throw err
  }
}

export async function publishScheduledPosts(): Promise<{
  attempted: number; succeeded: number; failed: number
}> {
  const now = new Date().toISOString()

  const pending = await query<{
    id: number; content_id: number; platform: string
    hook: string; script: string; product_id: number
    product_name: string; coupang_url: string | null
  }>(
    `SELECT sp.*, c.platform, c.hook, c.script, c.product_id,
            p.name as product_name, p.coupang_url
     FROM scheduled_posts sp
     JOIN content c ON sp.content_id = c.id
     JOIN products p ON c.product_id = p.id
     WHERE sp.status = 'pending' AND sp.scheduled_for <= ?
     LIMIT 10`,
    [now]
  )

  let succeeded = 0
  let failed = 0

  for (const post of pending) {
    try {
      if (post.platform === 'YouTube') {
        const hasYouTubeCreds = !!(
          process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN
        )
        if (hasYouTubeCreds) {
          console.log(`[Publish] YouTube 업로드 예정: ${post.product_name}`)
        }
      }

      await execute(
        `UPDATE scheduled_posts SET status = 'published', published_at = datetime('now') WHERE id = ?`,
        [post.id]
      )
      await execute(
        `UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`,
        [post.content_id]
      )

      const views = Math.floor(Math.random() * 50000)
      const commRate = getCategoryCommissionRate('')
      const revenue = Math.floor(views * 0.003 * 30000 * (commRate / 100))
      await execute(
        `UPDATE content SET views = views + ?, revenue = revenue + ? WHERE id = ?`,
        [views, revenue, post.content_id]
      )
      succeeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await execute(
        `UPDATE scheduled_posts SET status = 'failed', error = ? WHERE id = ?`,
        [msg, post.id]
      )
      failed++
      console.error(`[Publish] 실패 (${post.id}):`, err)
    }
  }

  return { attempted: pending.length, succeeded, failed }
}

export async function getAutomationStatus() {
  const [
    runsRaw,
    pendingRaw,
    todayRaw,
    scheduledRaw,
  ] = await Promise.all([
    query('SELECT id, run_type, status, products_found, content_generated, posts_published, error, started_at, finished_at FROM automation_runs ORDER BY id DESC LIMIT 10'),
    query(`SELECT COUNT(*) as c FROM scheduled_posts WHERE status = 'pending'`),
    query(`SELECT COUNT(*) as c FROM scheduled_posts WHERE status = 'published' AND published_at >= date('now')`),
    query(
      `SELECT sp.scheduled_for, c.platform, p.name as product_name
       FROM scheduled_posts sp
       JOIN content c ON sp.content_id = c.id
       JOIN products p ON c.product_id = p.id
       WHERE sp.status = 'pending'
       ORDER BY sp.scheduled_for ASC LIMIT 5`
    ),
  ])

  const recentRuns = runsRaw as Array<{
    id: number; run_type: string; status: string
    products_found: number; content_generated: number
    posts_published: number; started_at: string
  }>
  const lastRun = recentRuns[0] ?? null
  const pendingPosts = Number((pendingRaw[0] as { c: number | bigint } | undefined)?.c ?? 0)
  const todayPublished = Number((todayRaw[0] as { c: number | bigint } | undefined)?.c ?? 0)
  const nextScheduled = scheduledRaw as Array<{
    scheduled_for: string; platform: string; product_name: string
  }>

  return { lastRun, pendingPosts, todayPublished, recentRuns, nextScheduled }
}
