import { query, queryOne, execute } from '@/lib/db'
import { searchTrendingProducts, generateAffiliateLink } from '@/lib/coupang'
import { runContentAgent } from '@/lib/agents/content-agent'
import { submitShotstackScenicRender } from '@/lib/shotstack'
import { generateVideoScenario } from '@/lib/agents/scenario-agent'
import { generateProductImage, buildProductImagePrompt } from '@/lib/agents/image-agent'
import { uploadYouTubeShorts, buildShortsDescription, buildShortsTags, postTopComment } from '@/lib/youtube'
import { submitVeoJob, buildVeoPrompt, downloadVeoVideo } from '@/lib/agents/veo-agent'
import { uploadVideoToBlob, deleteBlob } from '@/lib/blob-storage'
import { postInstagramReel } from '@/lib/instagram'
import { postTikTokVideo } from '@/lib/tiktok'

// ─── 타입 정의 ───────────────────────────────────────────────────────────────

export type NodeType =
  | 'product_discovery'
  | 'content_generation'
  | 'video_render'
  | 'youtube_upload'
  | 'instagram_reel'
  | 'tiktok_video'
  | 'schedule_post'
  | 'revenue_sync'
  | 'notify'

export type TriggerType = 'cron' | 'manual' | 'webhook'
export type JobStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed'

export interface JobInput {
  keyword?: string
  productId?: number
  contentId?: number
  renderId?: string
  videoUrl?: string
  blobUrl?: string
  platform?: string
  market?: string
  language?: string
  runId?: number
}

// ─── 훅 레지스트리 ─────────────────────────────────────────────────────────────
// on:node_complete → 다음 노드 자동 큐잉

const NODE_SUCCESSORS: Partial<Record<NodeType, NodeType[]>> = {
  product_discovery: ['content_generation'],
  content_generation: ['video_render', 'schedule_post'],
  video_render: [],           // waiting → webhook이 youtube_upload 큐
  youtube_upload: ['instagram_reel', 'tiktok_video', 'revenue_sync', 'notify'],
  instagram_reel: [],
  tiktok_video: [],
  schedule_post: [],
  revenue_sync: [],
  notify: [],
}

// ─── 잡 관리 ──────────────────────────────────────────────────────────────────

export async function createJob(
  workflowName: string,
  nodeType: NodeType,
  input: JobInput,
  triggerType: TriggerType = 'manual'
): Promise<number> {
  const { lastInsertRowid } = await execute(
    `INSERT INTO workflow_jobs
       (workflow_name, node_type, trigger_type, status, input_data, product_id, content_id)
     VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
    [workflowName, nodeType, triggerType, JSON.stringify(input),
     input.productId ?? null, input.contentId ?? null]
  )
  return lastInsertRowid
}

async function completeJob(jobId: number, output: Record<string, unknown>): Promise<void> {
  await execute(
    `UPDATE workflow_jobs
     SET status = 'completed', output_data = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [JSON.stringify(output), jobId]
  )
}

async function failJob(jobId: number, error: string): Promise<void> {
  await execute(
    `UPDATE workflow_jobs
     SET status = 'failed', error = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [error, jobId]
  )
}

// ─── 잡 실행기 ────────────────────────────────────────────────────────────────

export async function processJob(jobId: number): Promise<void> {
  const job = await queryOne<{
    id: number; workflow_name: string; node_type: string
    trigger_type: string; input_data: string | null
    product_id: number | null; content_id: number | null
  }>('SELECT * FROM workflow_jobs WHERE id = ? AND status = \'queued\'', [jobId])

  if (!job) return // 이미 처리됐거나 없음

  await execute(
    `UPDATE workflow_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?`,
    [jobId]
  )

  const input: JobInput = job.input_data ? JSON.parse(job.input_data) : {}

  try {
    await dispatchNode(
      job.node_type as NodeType,
      job.workflow_name,
      jobId,
      input,
      job.trigger_type as TriggerType
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failJob(jobId, msg)
    console.error(`[Workflow] Job ${jobId} (${job.node_type}) failed:`, msg)
  }
}

export async function processPendingJobs(workflowName?: string, limit = 20): Promise<number> {
  const jobs = await query<{ id: number }>(
    workflowName
      ? `SELECT id FROM workflow_jobs WHERE status = 'queued' AND workflow_name = ? ORDER BY id ASC LIMIT ?`
      : `SELECT id FROM workflow_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT ?`,
    workflowName ? [workflowName, limit] : [limit]
  )

  let count = 0
  for (const job of jobs) {
    await processJob(job.id)
    count++
  }
  return count
}

// ─── 노드 디스패처 ────────────────────────────────────────────────────────────

async function dispatchNode(
  nodeType: NodeType,
  workflowName: string,
  jobId: number,
  input: JobInput,
  triggerType: TriggerType
): Promise<void> {
  switch (nodeType) {
    case 'product_discovery':  return nodeProductDiscovery(workflowName, jobId, input, triggerType)
    case 'content_generation': return nodeContentGeneration(workflowName, jobId, input, triggerType)
    case 'video_render':       return nodeVideoRender(workflowName, jobId, input, triggerType)
    case 'youtube_upload':     return nodeYouTubeUpload(workflowName, jobId, input)
    case 'instagram_reel':     return nodeInstagramReel(workflowName, jobId, input)
    case 'tiktok_video':       return nodeTikTokVideo(workflowName, jobId, input)
    case 'schedule_post':      return nodeSchedulePost(workflowName, jobId, input)
    case 'revenue_sync':       return nodeRevenueSync(workflowName, jobId, input)
    case 'notify':             return nodeNotify(workflowName, jobId, input)
    default: throw new Error(`Unknown node: ${nodeType}`)
  }
}

// ─── 노드 구현 ────────────────────────────────────────────────────────────────

// 훅: 제품 발굴 → content_generation 큐
async function nodeProductDiscovery(
  workflowName: string, jobId: number, input: JobInput, triggerType: TriggerType
): Promise<void> {
  const keyword = input.keyword || '트렌드 핫템'
  const products = await searchTrendingProducts(keyword, 5)

  const productIds: number[] = []
  for (const p of products) {
    const exists = await queryOne<{ id: number }>('SELECT id FROM products WHERE name = ?', [p.productName])
    if (exists) {
      productIds.push(exists.id)
    } else {
      const aff = await generateAffiliateLink(p.productUrl, p.productId, p.commissionRate)
      const { lastInsertRowid } = await execute(
        `INSERT INTO products (name, category, coupang_url, commission_rate, viral_score, estimated_revenue, target_market)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.productName, p.categoryName, aff.shortUrl, p.commissionRate,
         0,
         0,
         input.market || 'KR']
      )
      productIds.push(lastInsertRowid)
    }
  }

  await completeJob(jobId, { productIds, count: productIds.length, keyword })

  // 훅 발동: 각 제품 → content_generation 큐
  for (const productId of productIds.slice(0, 3)) {
    const childId = await createJob(workflowName, 'content_generation', {
      productId, market: input.market || 'KR', language: input.language || 'ko',
    }, triggerType)
    console.log(`[Workflow] Hook: product_found → content_generation queued (job ${childId})`)
  }
}

// 훅: 콘텐츠 생성 → YouTube는 video_render, 나머지는 schedule_post 큐
async function nodeContentGeneration(
  workflowName: string, jobId: number, input: JobInput, triggerType: TriggerType
): Promise<void> {
  if (!input.productId) throw new Error('productId required')

  const product = await queryOne<{ id: number; name: string; category: string; coupang_url: string | null }>(
    'SELECT * FROM products WHERE id = ?', [input.productId]
  )
  if (!product) throw new Error(`Product ${input.productId} not found`)

  const existing = await queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM content WHERE product_id = ? AND created_at > datetime('now', '-1 days')`,
    [input.productId]
  )
  if ((existing?.c ?? 0) > 0) {
    await completeJob(jobId, { skipped: true, reason: 'content_exists_today' })
    return
  }

  await runContentAgent(product.id, product.name, product.category, undefined, input.market || 'KR', input.language || 'ko')

  const contents = await query<{ id: number; platform: string }>(
    `SELECT id, platform FROM content WHERE product_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 6`,
    [input.productId]
  )

  await completeJob(jobId, { contentIds: contents.map(c => c.id), count: contents.length })

  // 훅 발동: 플랫폼별 분기
  for (const c of contents) {
    if (c.platform === 'YouTube') {
      const childId = await createJob(workflowName, 'video_render', {
        contentId: c.id, productId: input.productId, language: input.language || 'ko',
      }, triggerType)
      console.log(`[Workflow] Hook: content_created(YouTube) → video_render queued (job ${childId})`)
    } else {
      const childId = await createJob(workflowName, 'schedule_post', {
        contentId: c.id, platform: c.platform,
      }, triggerType)
      console.log(`[Workflow] Hook: content_created(${c.platform}) → schedule_post queued (job ${childId})`)
    }
  }
}

// 훅: 영상 렌더링 → waiting 상태 (Shotstack webhook이 youtube_upload 트리거)
async function nodeVideoRender(
  workflowName: string, jobId: number, input: JobInput, triggerType: TriggerType
): Promise<void> {
  if (!input.contentId) throw new Error('contentId required')

  const content = await queryOne<{ id: number; hook: string | null; script: string | null; product_name: string; category: string | null; price: number | null; coupang_url: string | null }>(
    `SELECT c.id, c.hook, c.script, p.name as product_name, p.category, p.price, p.coupang_url
     FROM content c JOIN products p ON c.product_id = p.id WHERE c.id = ?`,
    [input.contentId]
  )
  if (!content) throw new Error(`Content ${input.contentId} not found`)

  const hasVeo = !!process.env.GEMINI_API_KEY
  const hasShotstack = !!process.env.SHOTSTACK_API_KEY

  if (!hasVeo && !hasShotstack) {
    await completeJob(jobId, { skipped: true, reason: 'no_video_engine' })
    await createJob(workflowName, 'schedule_post', { contentId: input.contentId, platform: 'YouTube' }, triggerType)
    return
  }

  const language = input.language || 'ko'

  // 시나리오 생성 (Gemini) + 제품 이미지 생성 병렬
  const [scenario, imageUrl] = await Promise.all([
    generateVideoScenario(
      content.product_name,
      content.category || '일반',
      content.price || undefined,
      language,
      content.hook || undefined,
      content.script || undefined,
      content.coupang_url || undefined,
    ),
    generateProductImage(
      buildProductImagePrompt(content.product_name, content.category || '일반'),
      content.category || '일반',
      content.product_name,
    ),
  ])

  // ① Veo 우선 (Gemini Pro 구독 기반), ② Shotstack 폴백
  let renderId: string
  if (hasVeo) {
    try {
      const veoPrompt = buildVeoPrompt(scenario, content.product_name, language)
      renderId = await submitVeoJob(veoPrompt)
      console.log(`[Workflow] Veo 영상 생성 시작: ${renderId}`)
    } catch (veoErr) {
      if (!hasShotstack) throw veoErr
      console.warn('[Workflow] Veo 실패, Shotstack 폴백:', veoErr instanceof Error ? veoErr.message : String(veoErr))
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shorts-dashboard-one.vercel.app'
      const callbackUrl = `${baseUrl}/api/webhook/shotstack?secret=${process.env.CRON_SECRET || ''}`
      renderId = await submitShotstackScenicRender(scenario, content.product_name, imageUrl, language, callbackUrl, content.coupang_url || undefined)
    }
  } else {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shorts-dashboard-one.vercel.app'
    const callbackUrl = `${baseUrl}/api/webhook/shotstack?secret=${process.env.CRON_SECRET || ''}`
    renderId = await submitShotstackScenicRender(scenario, content.product_name, imageUrl, language, callbackUrl, content.coupang_url || undefined)
  }

  // waiting 상태로 전환 — webhook이 올 때까지 대기
  await execute(
    `UPDATE workflow_jobs SET status = 'waiting', render_id = ? WHERE id = ?`,
    [renderId, jobId]
  )
  await execute(
    `UPDATE content SET render_id = ? WHERE id = ?`,
    [renderId, input.contentId]
  )

  console.log(`[Workflow] Hook: video_render submitted → waiting (render_id: ${renderId}, job ${jobId})`)
}

// Shotstack webhook 수신 시 호출 — waiting 잡 재개 → youtube_upload 큐
export async function resumeVideoRenderJob(renderId: string, videoUrl: string): Promise<void> {
  const job = await queryOne<{
    id: number; workflow_name: string; input_data: string | null; trigger_type: string
  }>(
    `SELECT id, workflow_name, input_data, trigger_type
     FROM workflow_jobs WHERE render_id = ? AND status = 'waiting'`,
    [renderId]
  )
  if (!job) {
    console.warn(`[Workflow] No waiting job for render_id: ${renderId}`)
    return
  }

  const input: JobInput = job.input_data ? JSON.parse(job.input_data) : {}

  await completeJob(job.id, { renderId, videoUrl })

  if (input.contentId) {
    await execute('UPDATE content SET video_url = ? WHERE id = ?', [videoUrl, input.contentId])
  }

  // 훅 발동: video_ready → youtube_upload
  const childId = await createJob(job.workflow_name, 'youtube_upload', {
    contentId: input.contentId, videoUrl,
  }, job.trigger_type as TriggerType)

  console.log(`[Workflow] Hook: video_ready → youtube_upload queued (job ${childId})`)
  await processJob(childId)
}

// 훅: YouTube 업로드 → revenue_sync + notify
async function nodeYouTubeUpload(
  workflowName: string, jobId: number, input: JobInput
): Promise<void> {
  if (!input.contentId || !input.videoUrl) throw new Error('contentId and videoUrl required')

  // 이미 posted 상태면 중복 업로드 방지
  const currentStatus = await queryOne<{ status: string }>(
    'SELECT status FROM content WHERE id = ?',
    [input.contentId]
  )
  if (currentStatus?.status === 'posted') {
    await completeJob(jobId, { skipped: true, reason: 'already_posted', contentId: input.contentId })
    console.log(`[Workflow] youtube_upload skipped: content ${input.contentId} already posted`)
    return
  }

  const content = await queryOne<{
    id: number; hook: string | null; script: string | null
    product_name: string; category: string; coupang_url: string | null
  }>(
    `SELECT c.id, c.hook, c.script, p.name as product_name, p.category, p.coupang_url
     FROM content c JOIN products p ON c.product_id = p.id WHERE c.id = ?`,
    [input.contentId]
  )
  if (!content) throw new Error(`Content ${input.contentId} not found`)

  const tags = buildShortsTags(content.product_name, content.category)
  const affiliateUrl = content.coupang_url || 'https://www.coupang.com'
  // @everyday-c 스타일: 훅→링크→해시태그 순서
  const description = buildShortsDescription(content.hook || content.script || '', affiliateUrl, tags)
  const pinnedComment = `🔥 최저가 링크 → ${affiliateUrl}`

  // Veo URI: googleapis.com 또는 base64 data URI — API 키 인증 다운로드 또는 디코딩
  const isVeoUri = input.videoUrl.includes('generativelanguage.googleapis.com') || input.videoUrl.startsWith('data:')
  const videoBuffer = isVeoUri
    ? await downloadVeoVideo(input.videoUrl)
    : Buffer.from(await (await fetch(input.videoUrl)).arrayBuffer())

  const result = await uploadYouTubeShorts({
    title: (content.hook || content.product_name).slice(0, 100),
    description,
    tags,
    privacyStatus: 'private',
    madeForKids: false,
  }, videoBuffer)

  await execute(`UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`, [input.contentId])
  await execute(
    `UPDATE scheduled_posts SET youtube_video_id = ?, status = 'published', published_at = datetime('now')
     WHERE content_id = ? AND platform = 'YouTube'`,
    [result.videoId, input.contentId]
  )

  // Blob에 영상 업로드 → Instagram/TikTok 공개 URL 확보
  let blobUrl: string | undefined
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const filename = `${input.contentId}-${Date.now()}.mp4`
      const { url } = await uploadVideoToBlob(videoBuffer, filename)
      blobUrl = url
      console.log(`[Workflow] Blob 업로드 완료: ${blobUrl}`)
    } catch (e) {
      console.warn('[Workflow] Blob 업로드 실패 (Instagram/TikTok 스킵):', e instanceof Error ? e.message : String(e))
    }
  }

  await completeJob(jobId, { videoId: result.videoId, url: result.url, blobUrl })

  // 훅 발동: youtube_uploaded → 워터폴 병렬 큐
  const waterfallJobs: Promise<void>[] = []
  const waterfallInput = { contentId: input.contentId, videoUrl: input.videoUrl, blobUrl }

  if (blobUrl && process.env.INSTAGRAM_ACCESS_TOKEN) {
    const igId = await createJob(workflowName, 'instagram_reel', waterfallInput, 'webhook')
    waterfallJobs.push(processJob(igId))
    console.log(`[Workflow] Hook: youtube_uploaded → instagram_reel(${igId}) queued`)
  }
  if (blobUrl && process.env.TIKTOK_ACCESS_TOKEN) {
    const ttId = await createJob(workflowName, 'tiktok_video', waterfallInput, 'webhook')
    waterfallJobs.push(processJob(ttId))
    console.log(`[Workflow] Hook: youtube_uploaded → tiktok_video(${ttId}) queued`)
  }

  const r1 = await createJob(workflowName, 'revenue_sync', { contentId: input.contentId }, 'webhook')
  const r2 = await createJob(workflowName, 'notify', { contentId: input.contentId }, 'webhook')
  waterfallJobs.push(processJob(r1), processJob(r2))
  console.log(`[Workflow] Hook: youtube_uploaded → revenue_sync(${r1}), notify(${r2}) queued`)
  await Promise.all(waterfallJobs)
}

// 비-YouTube 플랫폼 스케줄 등록
async function nodeSchedulePost(
  _workflowName: string, jobId: number, input: JobInput
): Promise<void> {
  if (!input.contentId) throw new Error('contentId required')

  const HOURS = [9, 12, 15, 18, 20, 22]
  const now = new Date()
  const scheduled = new Date(now)
  scheduled.setHours(HOURS[now.getHours() % HOURS.length], 0, 0, 0)
  if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 1)

  await execute(
    `INSERT OR IGNORE INTO scheduled_posts (content_id, platform, scheduled_for, status) VALUES (?, ?, ?, 'pending')`,
    [input.contentId, input.platform || 'Instagram', scheduled.toISOString()]
  )
  await execute(`UPDATE content SET status = 'scheduled' WHERE id = ?`, [input.contentId])

  await completeJob(jobId, { scheduled: scheduled.toISOString(), platform: input.platform })
}

// 수익 동기화
async function nodeRevenueSync(
  _workflowName: string, jobId: number, input: JobInput
): Promise<void> {
  const acc = await queryOne<{ id: number }>(`SELECT id FROM accounts WHERE platform = 'YouTube' LIMIT 1`)
  if (!input.contentId || !acc) {
    await completeJob(jobId, { skipped: true })
    return
  }

  // 실제 YouTube Analytics / 쿠팡 파트너스 API 미연동 — 수익 데이터 기록 안 함
  await completeJob(jobId, { note: '수익은 실제 API 연동 후 집계됩니다.' })
}

// Discord 알림
async function nodeNotify(
  _workflowName: string, jobId: number, input: JobInput
): Promise<void> {
  const webhookUrl = process.env.SHORTS_DISCORD_WEBHOOK
  if (!webhookUrl) {
    await completeJob(jobId, { skipped: true, reason: 'no_discord_webhook' })
    return
  }

  try {
    const { sendDiscordWebhook, makeEmbed, COLORS } = await import('@/lib/discord')
    await sendDiscordWebhook(webhookUrl, '', [
      makeEmbed('✅ 워크플로우 완료', `콘텐츠 ID: ${input.contentId}`, COLORS.green, [
        { name: '플랫폼', value: 'YouTube Shorts', inline: true },
        { name: '상태', value: '업로드 완료', inline: true },
      ]),
    ])
    await completeJob(jobId, { notified: true })
  } catch {
    await completeJob(jobId, { skipped: true, reason: 'discord_error' })
  }
}

// 훅: Instagram Reels 업로드 (Blob 공개 URL 사용)
async function nodeInstagramReel(
  _workflowName: string, jobId: number, input: JobInput
): Promise<void> {
  if (!input.blobUrl) {
    await completeJob(jobId, { skipped: true, reason: 'no_blob_url' })
    return
  }
  if (!process.env.INSTAGRAM_ACCESS_TOKEN) {
    await completeJob(jobId, { skipped: true, reason: 'no_instagram_token' })
    return
  }

  const content = await queryOne<{ hook: string | null; script: string | null; product_name: string; coupang_url: string | null }>(
    `SELECT c.hook, c.script, p.name as product_name, p.coupang_url
     FROM content c JOIN products p ON c.product_id = p.id WHERE c.id = ?`,
    [input.contentId]
  )
  if (!content) {
    await completeJob(jobId, { skipped: true, reason: 'content_not_found' })
    return
  }

  const affiliateUrl = content.coupang_url || 'https://www.coupang.com'
  const caption = [
    content.hook || content.product_name,
    '',
    content.script?.slice(0, 200) || '',
    '',
    '⚠️ 이 영상은 쿠팡 파트너스 활동으로 수수료를 받을 수 있습니다.',
    '⚠️ AI(인공지능)로 생성된 콘텐츠입니다.',
    `🛒 구매링크: ${affiliateUrl}`,
    '#쇼핑추천 #핫템 #쿠팡 #AI생성',
  ].join('\n')

  try {
    const result = await postInstagramReel({ videoUrl: input.blobUrl, caption })
    await execute(
      `INSERT OR IGNORE INTO scheduled_posts (content_id, platform, status, published_at) VALUES (?, 'Instagram', 'published', datetime('now'))`,
      [input.contentId]
    )
    await completeJob(jobId, { mediaId: result.mediaId, url: result.url })
    console.log(`[Workflow] Instagram Reels 업로드 완료: ${result.url}`)
    // Blob 정리는 TikTok까지 완료 후 별도 처리 (24h 내 자동 만료)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await completeJob(jobId, { skipped: true, reason: msg })
    console.warn('[Workflow] Instagram Reels 실패 (건너뜀):', msg)
  }
}

// 훅: TikTok 업로드 (Blob 공개 URL 사용)
async function nodeTikTokVideo(
  _workflowName: string, jobId: number, input: JobInput
): Promise<void> {
  if (!input.blobUrl) {
    await completeJob(jobId, { skipped: true, reason: 'no_blob_url' })
    return
  }
  if (!process.env.TIKTOK_ACCESS_TOKEN) {
    await completeJob(jobId, { skipped: true, reason: 'no_tiktok_token' })
    return
  }

  const content = await queryOne<{ hook: string | null; product_name: string }>(
    `SELECT c.hook, p.name as product_name FROM content c JOIN products p ON c.product_id = p.id WHERE c.id = ?`,
    [input.contentId]
  )
  if (!content) {
    await completeJob(jobId, { skipped: true, reason: 'content_not_found' })
    return
  }

  try {
    const result = await postTikTokVideo({
      videoUrl: input.blobUrl,
      title: (content.hook || content.product_name).slice(0, 150),
      privacyLevel: 'SELF_ONLY',
    })

    // Blob 삭제 (Instagram/TikTok 모두 완료 후)
    if (input.blobUrl) {
      await deleteBlob(input.blobUrl).catch(() => {})
    }

    await completeJob(jobId, { publishId: result.publishId })
    console.log(`[Workflow] TikTok 업로드 완료: publishId=${result.publishId}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await completeJob(jobId, { skipped: true, reason: msg })
    console.warn('[Workflow] TikTok 실패 (건너뜀):', msg)
  }
}

// ─── 워크플로우 시작 진입점 ──────────────────────────────────────────────────

const DAILY_KEYWORDS = ['트렌드 핫템', '다이소 꿀템', '뷰티 추천', '유아 육아템', '홈트 운동', '주방 정리템', '스킨케어 추천']

export async function startWorkflow(
  workflowName: string,
  triggerType: TriggerType = 'manual',
  overrides: Partial<JobInput> = {}
): Promise<{ rootJobId: number; message: string }> {
  const keyword = overrides.keyword || DAILY_KEYWORDS[new Date().getDay() % DAILY_KEYWORDS.length]

  const rootJobId = await createJob(workflowName, 'product_discovery', {
    keyword,
    market: overrides.market || 'KR',
    language: overrides.language || 'ko',
    ...overrides,
  }, triggerType)

  console.log(`[Workflow] Started "${workflowName}" trigger=${triggerType} keyword="${keyword}" rootJob=${rootJobId}`)

  // 동기 실행: product_discovery → content_generation까지
  // video_render는 비동기 (webhook 대기)
  await processJob(rootJobId)
  await processPendingJobs(workflowName, 10)

  return { rootJobId, message: `워크플로우 "${workflowName}" 시작됨 (rootJob: ${rootJobId})` }
}

// ─── 상태 조회 ───────────────────────────────────────────────────────────────

export async function getWorkflowStatus(workflowName?: string, limit = 50) {
  return query<{
    id: number; workflow_name: string; node_type: string; trigger_type: string
    status: string; product_id: number | null; content_id: number | null
    render_id: string | null; error: string | null; created_at: string; completed_at: string | null
  }>(
    workflowName
      ? `SELECT id, workflow_name, node_type, trigger_type, status, product_id, content_id, render_id, error, created_at, completed_at
         FROM workflow_jobs WHERE workflow_name = ? ORDER BY id DESC LIMIT ?`
      : `SELECT id, workflow_name, node_type, trigger_type, status, product_id, content_id, render_id, error, created_at, completed_at
         FROM workflow_jobs ORDER BY id DESC LIMIT ?`,
    workflowName ? [workflowName, limit] : [limit]
  )
}

export { NODE_SUCCESSORS }
