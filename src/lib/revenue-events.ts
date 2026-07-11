import { execute, queryOne } from '@/lib/db'
import { refreshProductProfitability } from '@/lib/profitability'
import { refreshProductDecisions } from '@/lib/product-selection'

export type RevenueEventType = 'commission' | 'refund' | 'adjustment'
export type SettlementStatus = 'pending' | 'settled'

export interface RevenueEventInput {
  platform: string
  source: string
  amount: number
  period: string
  note?: string | null
  productId?: number | null
  contentId?: number | null
  externalId?: string | null
  eventType?: RevenueEventType
  currency?: string
  occurredAt?: string | null
  settlementStatus?: SettlementStatus
  dataCompleteThrough?: string | null
}

interface PreparedRevenueEvent {
  platform: string
  source: string
  amount: number
  period: string
  note: string | null
  productId: number | null
  contentId: number | null
  externalId: string | null
  eventType: RevenueEventType
  currency: 'KRW'
  occurredAt: string | null
  settlementStatus: SettlementStatus
  dataCompleteThrough: string | null
}

export class RevenueEventValidationError extends Error {}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength)
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

export async function prepareRevenueEvent(
  input: RevenueEventInput,
  options: { requireExternalId?: boolean } = {}
): Promise<PreparedRevenueEvent> {
  const platform = cleanText(input.platform, 80)
  const source = cleanText(input.source, 80)
  const period = cleanText(input.period, 7)
  if (!platform || !source || !/^\d{4}-\d{2}$/.test(period)) {
    throw new RevenueEventValidationError('플랫폼, 원천, 정산 기간(YYYY-MM)이 필요합니다.')
  }
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    throw new RevenueEventValidationError('0이 아닌 유효한 금액이 필요합니다.')
  }

  const eventType = input.eventType || 'commission'
  const settlementStatus = input.settlementStatus || 'settled'
  if (!['commission', 'refund', 'adjustment'].includes(eventType)) {
    throw new RevenueEventValidationError('지원하지 않는 수익 이벤트 유형입니다.')
  }
  if (!['pending', 'settled'].includes(settlementStatus)) {
    throw new RevenueEventValidationError('지원하지 않는 정산 상태입니다.')
  }

  const currency = cleanText(input.currency || 'KRW', 3).toUpperCase()
  if (currency !== 'KRW') {
    throw new RevenueEventValidationError('환율 근거 없는 합산 방지를 위해 현재 KRW만 지원합니다.')
  }

  const externalId = cleanText(input.externalId, 128) || null
  if (options.requireExternalId && !externalId) {
    throw new RevenueEventValidationError('자동 수집 이벤트에는 externalId가 필요합니다.')
  }

  const occurredAt = cleanText(input.occurredAt, 10) || null
  const dataCompleteThrough = cleanText(input.dataCompleteThrough, 10) || null
  if (occurredAt && !isDate(occurredAt)) {
    throw new RevenueEventValidationError('occurredAt은 YYYY-MM-DD 형식이어야 합니다.')
  }
  if (dataCompleteThrough && !isDate(dataCompleteThrough)) {
    throw new RevenueEventValidationError('dataCompleteThrough은 YYYY-MM-DD 형식이어야 합니다.')
  }

  const contentId = input.contentId && Number.isInteger(input.contentId) && input.contentId > 0
    ? input.contentId
    : null
  let productId = input.productId && Number.isInteger(input.productId) && input.productId > 0
    ? input.productId
    : null

  if (contentId) {
    const content = await queryOne<{ product_id: number }>('SELECT product_id FROM content WHERE id = ?', [contentId])
    if (!content) throw new RevenueEventValidationError('존재하지 않는 콘텐츠입니다.')
    if (productId && productId !== Number(content.product_id)) {
      throw new RevenueEventValidationError('콘텐츠와 상품이 일치하지 않습니다.')
    }
    productId = Number(content.product_id)
  } else if (productId) {
    const product = await queryOne<{ id: number }>('SELECT id FROM products WHERE id = ?', [productId])
    if (!product) throw new RevenueEventValidationError('존재하지 않는 상품입니다.')
  }

  const absolute = Math.abs(Math.round(input.amount))
  const amount = eventType === 'refund'
    ? -absolute
    : eventType === 'commission'
      ? absolute
      : Math.round(input.amount)

  return {
    platform,
    source,
    amount,
    period,
    note: cleanText(input.note, 500) || null,
    productId,
    contentId,
    externalId,
    eventType,
    currency: 'KRW',
    occurredAt,
    settlementStatus,
    dataCompleteThrough,
  }
}

export async function upsertRevenueEvent(event: PreparedRevenueEvent): Promise<{ id: number; updated: boolean }> {
  if (event.externalId) {
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM manual_revenue_entries
       WHERE platform = ? AND source = ? AND external_id = ? AND event_type = ?`,
      [event.platform, event.source, event.externalId, event.eventType]
    )
    if (existing) {
      await execute(
        `UPDATE manual_revenue_entries
         SET amount = ?, period = ?, note = ?, product_id = ?, content_id = ?, currency = ?,
             occurred_at = ?, settlement_status = ?
         WHERE id = ?`,
        [event.amount, event.period, event.note, event.productId, event.contentId, event.currency,
          event.occurredAt, event.settlementStatus, existing.id]
      )
      if (event.productId && event.dataCompleteThrough) {
        await execute('UPDATE products SET revenue_data_complete_through = ? WHERE id = ?', [event.dataCompleteThrough, event.productId])
      }
      return { id: Number(existing.id), updated: true }
    }
  }

  const result = await execute(
    `INSERT INTO manual_revenue_entries
     (platform, source, amount, period, note, product_id, content_id, external_id,
      event_type, currency, occurred_at, settlement_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.platform, event.source, event.amount, event.period, event.note, event.productId,
      event.contentId, event.externalId, event.eventType, event.currency, event.occurredAt,
      event.settlementStatus]
  )
  if (event.productId && event.dataCompleteThrough) {
    await execute('UPDATE products SET revenue_data_complete_through = ? WHERE id = ?', [event.dataCompleteThrough, event.productId])
  }
  return { id: result.lastInsertRowid, updated: false }
}

export async function refreshRevenueDerivedData(): Promise<void> {
  await refreshProductProfitability()
  await refreshProductDecisions()
}
