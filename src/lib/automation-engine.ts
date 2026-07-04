import { query, queryOne, execute } from '@/lib/db'
import { searchTrendingProducts, generateAffiliateLink, getCategoryCommissionRate } from '@/lib/coupang'
import { runTrendAgent } from '@/lib/agents/trend-agent'
import { runContentAgent } from '@/lib/agents/content-agent'
import { runClickAgent } from '@/lib/agents/click-agent'
import { runSeoAgent, buildOptimizedTags } from '@/lib/agents/seo-agent'
import { buildShortsDescription } from '@/lib/youtube'
import { sendDiscordWebhook, makeEmbed, COLORS } from '@/lib/discord'
import { getActiveMarkets, buildAffiliateUrl, getAffiliateDisclosure, MARKETS } from '@/lib/markets'
import { submitShotstackScenicRender } from '@/lib/shotstack'
import { submitVeoJob, buildVeoPrompt } from '@/lib/agents/veo-agent'
import { generateVideoScenario } from '@/lib/agents/scenario-agent'
import { generateProductImage, buildProductImagePrompt } from '@/lib/agents/image-agent'
import { postTistory, buildTistoryContent } from '@/lib/tistory'
import { postInstagramReel } from '@/lib/instagram'
import { postTikTokVideo } from '@/lib/tiktok'
import { postFacebookReel } from '@/lib/facebook'

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
  let videosCreated = 0
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
               0,
               0, market]
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
          const recent = await query<{ id: number }>(`SELECT id FROM products WHERE target_market = ? AND approved IS NOT 0 ORDER BY id DESC LIMIT 5`, [market])
          if (!recent.length) {
            const fallback = await query<{ id: number }>('SELECT id FROM products WHERE approved IS NOT 0 ORDER BY id DESC LIMIT 5')
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
        const recent = await query<{ id: number }>('SELECT id FROM products WHERE approved IS NOT 0 ORDER BY id DESC LIMIT 5')
        savedProductIds.push(...recent.map(r => r.id))
      }

      for (const productId of savedProductIds.slice(0, 3)) {
        const product = await queryOne<{ id: number; name: string; category: string; coupang_url: string | null }>(
          'SELECT * FROM products WHERE id = ? AND approved IS NOT 0', [productId]
        )
        if (!product) continue  // 없거나 거절된(approved=0) 제품 → 콘텐츠 생성 스킵

        const existingContent = await queryOne<{ c: number }>(
          `SELECT COUNT(*) as c FROM content WHERE product_id = ? AND target_market = ? AND created_at > datetime('now', '-14 days')`,
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
    product_name: string; category: string | null; price: number | null; coupang_url: string | null
    video_url: string | null; language: string | null
    render_id: string | null; retry_count: number
  }>(
    `SELECT sp.*, c.platform, c.hook, c.script, c.product_id, c.video_url, c.language, c.render_id,
            p.name as product_name, p.category, p.price, p.coupang_url
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
      // YouTube: async Shotstack render → webhook triggers upload
      if (post.platform === 'YouTube' && process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN) {
        const videoUrl = post.video_url

        // Already have video URL → upload directly
        if (videoUrl) {
          const { uploadYouTubeShorts, buildShortsTags } = await import('@/lib/youtube')
          const tags = buildShortsTags(post.product_name, '')
          const videoBuffer = Buffer.from(await (await fetch(videoUrl)).arrayBuffer())
          const ytResult = await uploadYouTubeShorts(
            { title: (post.hook || post.product_name).slice(0, 100), description: post.script || '', tags, privacyStatus: 'private', madeForKids: false },
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

        // Render already submitted → skip (webhook will handle it)
        if (post.render_id) {
          console.log(`[Publish] YouTube ${post.id}: Shotstack 렌더 대기 중 (${post.render_id})`)
          continue
        }

        // Veo(구독) 우선 → Shotstack 폴백
        const hasVeo = !!process.env.GEMINI_API_KEY
        const hasShotstack = !!process.env.SHOTSTACK_API_KEY
        if (!hasVeo && !hasShotstack) {
          console.warn(`[Publish] YouTube ${post.id} 건너뜀: 영상 엔진 미설정`)
          continue
        }

        try {
          const language = post.language || 'ko'
          const [scenario, imageUrl] = await Promise.all([
            generateVideoScenario(
              post.product_name,
              post.category || '일반',
              post.price || undefined,
              language,
              post.hook || undefined,
              post.script || undefined,
            ),
            generateProductImage(
              buildProductImagePrompt(post.product_name, post.category || '일반'),
              post.category || '일반',
              post.product_name,
            ),
          ])

          let renderId: string
          if (hasVeo) {
            try {
              renderId = await submitVeoJob(buildVeoPrompt(scenario, post.product_name, language))
              console.log(`[Publish] Veo 영상 생성 시작: ${renderId}`)
            } catch (veoErr) {
              if (!hasShotstack) throw veoErr
              console.warn('[Publish] Veo 실패, Shotstack 폴백:', veoErr instanceof Error ? veoErr.message : String(veoErr))
              const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shorts-dashboard-one.vercel.app'
              const callbackUrl = `${baseUrl}/api/webhook/shotstack?secret=${process.env.CRON_SECRET || ''}`
              renderId = await submitShotstackScenicRender(scenario, post.product_name, imageUrl, language, callbackUrl, post.coupang_url || undefined)
            }
          } else {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shorts-dashboard-one.vercel.app'
            const callbackUrl = `${baseUrl}/api/webhook/shotstack?secret=${process.env.CRON_SECRET || ''}`
            renderId = await submitShotstackScenicRender(scenario, post.product_name, imageUrl, language, callbackUrl, post.coupang_url || undefined)
          }

          await execute('UPDATE content SET render_id = ? WHERE id = ?', [renderId, post.content_id])
          console.log(`[Publish] 렌더 제출 완료: ${renderId}`)
        } catch (vidErr) {
          console.error('[Publish] 영상 생성 제출 실패:', vidErr)
        }
        continue
      }

      // Other platforms — real API posting
      const videoUrl = post.video_url
      if (!videoUrl) {
        await execute(
          `UPDATE scheduled_posts SET status = 'skipped', error = '영상 URL 없음 (YouTube 업로드 후 URL 필요)' WHERE id = ?`,
          [post.id]
        )
        console.log(`[Publish] ${post.platform} ${post.id} 건너뜀: 영상 URL 없음`)
        continue
      }

      const caption = [post.script || '', post.hook || ''].filter(Boolean).join('\n').slice(0, 2200)

      if (post.platform === 'Instagram' && process.env.INSTAGRAM_ACCESS_TOKEN) {
        const result = await postInstagramReel({ videoUrl, caption })
        await execute(
          `UPDATE scheduled_posts SET status = 'published', published_at = datetime('now'), error = NULL WHERE id = ?`,
          [post.id]
        )
        await execute(`UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`, [post.content_id])
        console.log(`[Publish] Instagram 게시 완료: ${result.url}`)
        succeeded++
        continue
      }

      if (post.platform === 'TikTok' && process.env.TIKTOK_ACCESS_TOKEN) {
        await postTikTokVideo({ videoUrl, title: (post.hook || post.product_name).slice(0, 150), privacyLevel: 'SELF_ONLY' })
        await execute(
          `UPDATE scheduled_posts SET status = 'published', published_at = datetime('now'), error = NULL WHERE id = ?`,
          [post.id]
        )
        await execute(`UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`, [post.content_id])
        console.log(`[Publish] TikTok 게시 완료`)
        succeeded++
        continue
      }

      if (post.platform === 'Facebook' && process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
        const result = await postFacebookReel({
          videoUrl,
          description: caption,
          title: (post.hook || post.product_name).slice(0, 255),
        })
        await execute(
          `UPDATE scheduled_posts SET status = 'published', published_at = datetime('now'), error = NULL WHERE id = ?`,
          [post.id]
        )
        await execute(`UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`, [post.content_id])
        console.log(`[Publish] Facebook 게시 완료: ${result.url}`)
        succeeded++
        continue
      }

      // No credential set for this platform
      await execute(
        `UPDATE scheduled_posts SET status = 'skipped', error = '${post.platform} API 자격증명 미설정' WHERE id = ?`,
        [post.id]
      )
      console.log(`[Publish] ${post.platform} ${post.id} 건너뜀: 자격증명 미설정`)
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
