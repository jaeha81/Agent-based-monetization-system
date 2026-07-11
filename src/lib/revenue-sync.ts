import { query } from '@/lib/db'
import { getCoupangRevenueReports, type CoupangRevenueReportRow } from '@/lib/coupang'
import { prepareRevenueEvent, refreshRevenueDerivedData, upsertRevenueEvent } from '@/lib/revenue-events'
import { getYouTubeVideoRevenueAnalytics, type YouTubeRevenueStatus } from '@/lib/youtube'

const COUPANG_REPORT_SOURCE = 'coupang_partners_reports_api'
const YOUTUBE_ESTIMATE_SOURCE = 'youtube_analytics_estimate'

interface ProductMatch {
  id: number
  name: string
  coupang_url: string | null
}

export interface RevenueSyncSummary {
  received: number
  inserted: number
  updated: number
  unmatched: number
  skipped: number
  pendingAmount: number
}

export interface YouTubeRevenueSyncSummary extends RevenueSyncSummary {
  status: YouTubeRevenueStatus
}

function normalizeDate(value: string | number | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (!/^\d{8}$/.test(raw)) return null
  const normalized = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  return Number.isNaN(Date.parse(`${normalized}T00:00:00Z`)) ? null : normalized
}

function findProduct(row: CoupangRevenueReportRow, products: ProductMatch[]): number | null {
  const externalProductId = String(row.productId || '')
  const byUrl = externalProductId
    ? products.find(product => product.coupang_url?.includes(externalProductId))
    : undefined
  if (byUrl) return byUrl.id
  const name = String(row.productName || '').trim()
  return products.find(product => product.name.trim() === name)?.id ?? null
}

export async function syncCoupangRevenueReports(startDate: string, endDate: string): Promise<RevenueSyncSummary> {
  const [reports, products] = await Promise.all([
    getCoupangRevenueReports(startDate, endDate),
    query<ProductMatch>('SELECT id, name, coupang_url FROM products'),
  ])
  const events = [
    ...reports.orders.map(row => ({ row, eventType: 'commission' as const })),
    ...reports.cancels.map(row => ({ row, eventType: 'refund' as const })),
  ]

  const summary: RevenueSyncSummary = {
    received: events.length,
    inserted: 0,
    updated: 0,
    unmatched: 0,
    skipped: 0,
    pendingAmount: 0,
  }

  for (const { row, eventType } of events) {
    const occurredAt = normalizeDate(row.date || row.orderDate)
    const commission = Number(row.commission || 0)
    if (!occurredAt || !Number.isFinite(commission) || commission === 0 || !row.orderId || !row.productId) {
      summary.skipped++
      continue
    }
    const productId = findProduct(row, products)
    if (!productId) summary.unmatched++
    const amount = eventType === 'refund' ? -Math.abs(commission) : Math.abs(commission)
    const externalId = `${eventType}:${row.orderId}:${row.productId}:${occurredAt}`
    const event = await prepareRevenueEvent({
      platform: '쿠팡 파트너스',
      source: COUPANG_REPORT_SOURCE,
      amount,
      period: occurredAt.slice(0, 7),
      note: `${row.productName || '상품명 없음'} · 주문 ${row.orderId}`,
      productId,
      externalId,
      eventType,
      currency: 'KRW',
      occurredAt,
      settlementStatus: 'pending',
    }, { requireExternalId: true })
    const result = await upsertRevenueEvent(event)
    if (result.updated) summary.updated++
    else summary.inserted++
    summary.pendingAmount += event.amount
  }

  if (summary.inserted || summary.updated) await refreshRevenueDerivedData()
  return summary
}

export async function syncYouTubeEstimatedRevenue(startDate: string, endDate: string): Promise<YouTubeRevenueSyncSummary> {
  const videos = await query<{
    youtube_video_id: string
    content_id: number
    product_id: number
  }>(`
    SELECT sp.youtube_video_id, sp.content_id, c.product_id
    FROM scheduled_posts sp
    JOIN content c ON c.id = sp.content_id
    WHERE sp.platform = 'YouTube'
      AND sp.status = 'published'
      AND sp.youtube_video_id IS NOT NULL
    ORDER BY sp.published_at DESC
    LIMIT 50
  `)
  const analytics = await getYouTubeVideoRevenueAnalytics(
    videos.map(video => video.youtube_video_id),
    startDate,
    endDate
  )
  const summary: YouTubeRevenueSyncSummary = {
    status: analytics.status,
    received: analytics.rows.length,
    inserted: 0,
    updated: 0,
    unmatched: 0,
    skipped: 0,
    pendingAmount: 0,
  }
  if (analytics.status !== 'ok') return summary

  const byVideoId = new Map(videos.map(video => [video.youtube_video_id, video]))
  for (const row of analytics.rows) {
    const video = byVideoId.get(row.videoId)
    if (!video) {
      summary.unmatched++
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.estimatedRevenue === 0) {
      summary.skipped++
      continue
    }
    const event = await prepareRevenueEvent({
      platform: 'YouTube AdSense',
      source: YOUTUBE_ESTIMATE_SOURCE,
      amount: row.estimatedRevenue,
      period: row.date.slice(0, 7),
      note: `YouTube Analytics 추정 수익 · 영상 ${row.videoId}`,
      productId: video.product_id,
      contentId: video.content_id,
      externalId: `estimate:${row.videoId}:${row.date}`,
      eventType: row.estimatedRevenue < 0 ? 'adjustment' : 'commission',
      currency: 'KRW',
      occurredAt: row.date,
      settlementStatus: 'pending',
    }, { requireExternalId: true })
    const result = await upsertRevenueEvent(event)
    if (result.updated) summary.updated++
    else summary.inserted++
    summary.pendingAmount += event.amount
  }

  if (summary.inserted || summary.updated) await refreshRevenueDerivedData()
  return summary
}
