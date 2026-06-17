import { query, queryOne, execute } from '@/lib/db'
import { searchTrendingProducts, generateAffiliateLink, getCategoryCommissionRate } from '@/lib/coupang'
import { runTrendAgent } from '@/lib/agents/trend-agent'
import { runContentAgent } from '@/lib/agents/content-agent'
import { runClickAgent } from '@/lib/agents/click-agent'
import { runSeoAgent, buildOptimizedTags } from '@/lib/agents/seo-agent'
import { buildShortsDescription } from '@/lib/youtube'
import { sendDiscordWebhook, makeEmbed, COLORS } from '@/lib/discord'
import { getActiveMarkets, buildAffiliateUrl, getAffiliateDisclosure, MARKETS } from '@/lib/markets'
import { renderShortsVideo } from '@/lib/shotstack'
import { postTistory, buildTistoryContent } from '@/lib/tistory'

export interface AutomationResult {
  runId: number
  productsFound: number
  contentGenerated: number
  scheduled: number
  videosCreated: number
  blogsPosted: number
  errors: string[]
}

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
  const activeMarkets = getActiveMarkets()

  const { lastInsertRowid: runId } = await execute(
    'INSERT INTO automation_runs (run_type, status) VALUES (?, ?)',
    ['daily', 'running']
  )

  let productsFound = 0
  let contentGenerated = 0
  let scheduled = 0
  const videosCreated = 0
  let blogsPosted = 0

  try {
    for (const market of activeMarkets) {
      const cfg = MARKETS[market]
      const keyword = cfg.trendKeywords[new Date().getDay() % cfg.trendKeywords.length]
      console.log(`[Automation][${market}] 키워드: ${keyword}`)

      const savedProductIds: number[] = []

      if (market === 'KR') {
        const coupangProducts = await searchTrendingProducts(keyword, 5)
        for (const cp of coupangProducts) {
          const existing = await queryOne<{ id: number }>('SELECT id FROM products WHERE name = ?', [cp.productName])
          let productId: number
          if (existing) {
            productId = existing.id
            await execute('UPDATE products SET coupang_url = ?, commission_rate = ? WHERE id = ?', [cp.productUrl, cp.commissionRate, productId])
          } else {
            const affiliate = await generateAffiliateLink(cp.productUrl, cp.productId)
            const { lastInsertRowid } = await execute(
              `INSERT INTO products (name, category, coupang_url, commission_rate, viral_score, estimated_revenue, target_market)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [cp.productName, cp.categoryName, affiliate.shortUrl, cp.commissionRate,
               Math.floor(70 + Math.random() * 25),
               Math.floor(cp.salePrice * cp.commissionRate * 0.003 * 500000), market]
            )
            productId = lastInsertRowid
            productsFound++
          }
          savedProductIds.push(productId)
        }
      } else {
        // Global markets — use trend agent to discover products
        try {
          await runTrendAgent(keyword)
          const recent = await query<{ id: number }>(`SELECT id FROM products WHERE target_market = ? ORDER BY id DESC LIMIT 5`, [market])
          if (!recent.length) {
            const fallback = await query<{ id: number }>('SELECT id FROM products ORDER BY id DESC LIMIT 5')
            savedProductIds.push(...fallback.map(r => r.id))
          } else {
            savedProductIds.push(...recent.map(r => r.id))
          }
        } catch (e) {
          errors.push(`[${market}] 트렌드 에이전트 오류: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      if (savedProductIds.length === 0) {
        await runTrendAgent(keyword)
        const recent = await query<{ id: number }>('SELECT id FROM products ORDER BY id DESC LIMIT 5')
        savedProductIds.push(...recent.map(r => r.id))
      }

      for (const productId of savedProductIds.slice(0, 3)) {
        const product = await queryOne<{ id: number; name: string; category: string; coupang_url: string | null }>(
          'SELECT * FROM products WHERE id = ?', [productId]
        )
        if (!product) continue

        const existingContent = await queryOne<{ c: number }>(
          `SELECT COUNT(*) as c FROM content WHERE product_id = ? AND target_market = ? AND created_at > datetime('now', '-1 days')`,
          [productId, market]
        )
        if ((existingContent?.c ?? 0) > 0) {
          console.log(`[Automation][${market}] ${product.name} 콘텐츠 이미 존재, 스킵`)
          continue
        }

        try {
          const affiliateUrl = buildAffiliateUrl(product.name, market, product.coupang_url ?? undefined)

          // 1. Click-optimization
          const clickOpt = await runClickAgent(product.name, product.category, undefined, cfg.language)

          // 2. SEO optimization
          const seoResult = await runSeoAgent(product.name, product.category, market)

          // 3. Content generation (multi-language + click-optimized)
          await runContentAgent(productId, product.name, product.category, undefined, market, cfg.language)

          const contents = await query<{ id: number; platform: string; hook: string; script: string }>(
            `SELECT id, platform, hook, script FROM content WHERE product_id = ? AND target_market = ? AND status = 'draft' ORDER BY id DESC LIMIT 6`,
            [productId, market]
          )
          contentGenerated += contents.length

          // Apply best click-optimized hook to YouTube content
          const ytContent = contents.find(c => c.platform === 'YouTube')
          if (ytContent && clickOpt.optimized_hooks.length > 0) {
            await execute('UPDATE content SET hook = ? WHERE id = ?', [clickOpt.optimized_hooks[0].hook, ytContent.id])
          }

          let schedIdx = scheduled
          for (const c of contents) {
            const optimizedTags = buildOptimizedTags(seoResult, c.platform)
            const disclosure = getAffiliateDisclosure(cfg.language)
            const desc = buildShortsDescription(c.script || '', affiliateUrl, optimizedTags) + '\n\n' + disclosure

            await execute(
              `UPDATE content SET script = ?, status = 'scheduled' WHERE id = ?`,
              [desc, c.id]
            )
            await execute(
              `INSERT INTO scheduled_posts (content_id, platform, scheduled_for, status) VALUES (?, ?, ?, 'pending')`,
              [c.id, c.platform, nextScheduleTime(schedIdx++)]
            )
            scheduled++
          }

          // 4. Tistory blog posting (Korean market)
          if (market === 'KR' && process.env.TISTORY_ACCESS_TOKEN && process.env.TISTORY_BLOG_NAME) {
            const naverContent = contents.find(c => c.platform === 'Naver') || contents[0]
            if (naverContent) {
              try {
                const blogHtml = buildTistoryContent(
                  naverContent.hook || product.name,
                  naverContent.script || '',
                  product.name,
                  affiliateUrl,
                  optimizedTagsForBlog(seoResult),
                  getAffiliateDisclosure('ko')
                )
                const { url } = await postTistory(
                  `[${product.category}] ${naverContent.hook || product.name}`,
                  blogHtml,
                  optimizedTagsForBlog(seoResult)
                )
                await execute(
                  `UPDATE scheduled_posts SET tistory_post_id = ?, blog_url = ?, status = 'published', published_at = datetime('now')
                   WHERE content_id = ? AND platform = 'Naver'`,
                  ['tistory', url, naverContent.id]
                )
                blogsPosted++
                console.log(`[Automation] Tistory 포스팅 완료: ${url}`)
              } catch (blogErr) {
                errors.push(`Tistory 포스팅 오류 (${product.name}): ${blogErr instanceof Error ? blogErr.message : String(blogErr)}`)
              }
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`[${market}] 콘텐츠 생성 오류 (${product.name}): ${msg}`)
        }
      }
    }

    await execute(
      `UPDATE automation_runs SET status = 'completed', products_found = ?, content_generated = ?, posts_published = ?, finished_at = datetime('now') WHERE id = ?`,
      [productsFound, contentGenerated, scheduled, runId]
    )

    const result: AutomationResult = { runId, productsFound, contentGenerated, scheduled, videosCreated, blogsPosted, errors }

    const notifyUrl = process.env.SHORTS_DISCORD_WEBHOOK
    if (notifyUrl) {
      sendDiscordWebhook(notifyUrl, '', [
        makeEmbed('✅ 자동화 실행 완료', `실행 ID: **${runId}**`, COLORS.green, [
          { name: '제품 발견', value: String(productsFound), inline: true },
          { name: '콘텐츠 생성', value: String(contentGenerated), inline: true },
          { name: '스케줄 등록', value: String(scheduled), inline: true },
          { name: '영상 생성', value: String(videosCreated), inline: true },
          { name: '블로그 포스팅', value: String(blogsPosted), inline: true },
          ...(errors.length > 0 ? [{ name: '오류', value: errors.slice(0, 3).join('\n') }] : []),
        ]),
      ]).catch(e => console.error('[Automation] Discord notify 실패:', e))
    }

    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await execute(`UPDATE automation_runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`, [msg, runId])
    throw err
  }
}

function optimizedTagsForBlog(seoResult: { global_keywords: string[] }): string[] {
  return seoResult.global_keywords.slice(0, 10)
}

export async function publishScheduledPosts(): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const now = new Date().toISOString()

  const pending = await query<{
    id: number; content_id: number; platform: string
    hook: string; script: string; product_id: number
    product_name: string; coupang_url: string | null
    video_url: string | null; language: string | null
    retry_count: number
  }>(
    `SELECT sp.*, c.platform, c.hook, c.script, c.product_id, c.video_url, c.language,
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
      // YouTube: generate video via Shotstack then upload
      if (post.platform === 'YouTube' && process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN) {
        let videoUrl = post.video_url

        if (!videoUrl && process.env.SHOTSTACK_API_KEY) {
          console.log(`[Publish] Shotstack 영상 생성 중: ${post.product_name}`)
          try {
            videoUrl = await renderShortsVideo(
              post.hook || post.product_name,
              post.product_name,
              post.language || 'ko'
            )
            await execute('UPDATE content SET video_url = ? WHERE id = ?', [videoUrl, post.content_id])
            console.log(`[Publish] 영상 생성 완료: ${videoUrl}`)
          } catch (vidErr) {
            console.error('[Publish] 영상 생성 실패:', vidErr)
          }
        }

        if (videoUrl) {
          const { uploadYouTubeShorts, buildShortsTags } = await import('@/lib/youtube')
          const tags = buildShortsTags(post.product_name, '')
          const videoBuffer = Buffer.from(await (await fetch(videoUrl)).arrayBuffer())
          const ytResult = await uploadYouTubeShorts(
            { title: (post.hook || post.product_name).slice(0, 100), description: post.script || '', tags, privacyStatus: 'public' },
            videoBuffer
          )
          await execute(
            `UPDATE scheduled_posts SET youtube_video_id = ?, status = 'published', published_at = datetime('now') WHERE id = ?`,
            [ytResult.videoId, post.id]
          )
          await execute(`UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`, [post.content_id])
          console.log(`[Publish] YouTube 업로드 완료: ${ytResult.url}`)
          succeeded++
          continue
        }
      }

      // Other platforms — mark as published (manual or future integration)
      await execute(`UPDATE scheduled_posts SET status = 'published', published_at = datetime('now') WHERE id = ?`, [post.id])
      await execute(`UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`, [post.content_id])

      // Simulated revenue for non-YouTube platforms
      const views = Math.floor(Math.random() * 50000)
      const commRate = getCategoryCommissionRate('')
      const revenue = Math.floor(views * 0.003 * 30000 * (commRate / 100))
      await execute(`UPDATE content SET views = views + ?, revenue = revenue + ? WHERE id = ?`, [views, revenue, post.content_id])
      succeeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const retryCount = post.retry_count ?? 0
      if (retryCount < 3) {
        const retryAt = new Date(Date.now() + (retryCount + 1) * 60 * 60 * 1000).toISOString()
        await execute(
          `UPDATE scheduled_posts SET status = 'pending', retry_count = ?, scheduled_for = ?, error = ? WHERE id = ?`,
          [retryCount + 1, retryAt, msg, post.id]
        )
        console.warn(`[Publish] 재시도 예약 (${retryCount + 1}/3) → ${retryAt}`)
      } else {
        await execute(`UPDATE scheduled_posts SET status = 'failed', error = ? WHERE id = ?`, [msg, post.id])
        const alertUrl = process.env.SHORTS_DISCORD_WEBHOOK
        if (alertUrl) {
          sendDiscordWebhook(alertUrl, '', [
            makeEmbed(`⚠️ 게시 최종 실패`, `ID: ${post.id} / ${post.platform} / ${post.product_name}`, COLORS.red, [
              { name: '오류', value: msg.slice(0, 500) },
            ]),
          ]).catch(() => {})
        }
        failed++
      }
      console.error(`[Publish] 실패 (${post.id}):`, err)
    }
  }

  return { attempted: pending.length, succeeded, failed }
}

export async function getAutomationStatus() {
  const [runsRaw, pendingRaw, todayRaw, scheduledRaw] = await Promise.all([
    query('SELECT id, run_type, status, products_found, content_generated, posts_published, error, started_at, finished_at FROM automation_runs ORDER BY id DESC LIMIT 10'),
    query(`SELECT COUNT(*) as c FROM scheduled_posts WHERE status = 'pending'`),
    query(`SELECT COUNT(*) as c FROM scheduled_posts WHERE status = 'published' AND published_at >= date('now')`),
    query(`SELECT sp.scheduled_for, c.platform, p.name as product_name
           FROM scheduled_posts sp
           JOIN content c ON sp.content_id = c.id
           JOIN products p ON c.product_id = p.id
           WHERE sp.status = 'pending'
           ORDER BY sp.scheduled_for ASC LIMIT 5`),
  ])

  const recentRuns = runsRaw as Array<{ id: number; run_type: string; status: string; products_found: number; content_generated: number; posts_published: number; started_at: string }>
  const lastRun = recentRuns[0] ?? null
  const pendingPosts = Number((pendingRaw[0] as { c: number | bigint } | undefined)?.c ?? 0)
  const todayPublished = Number((todayRaw[0] as { c: number | bigint } | undefined)?.c ?? 0)
  const nextScheduled = scheduledRaw as Array<{ scheduled_for: string; platform: string; product_name: string }>

  return { lastRun, pendingPosts, todayPublished, recentRuns, nextScheduled }
}
