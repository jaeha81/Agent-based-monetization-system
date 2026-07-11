export const PRIVATE_UPLOAD_STATUS = 'uploaded_private' as const

export function requireAffiliateUrl(value: string | null | undefined): string {
  const raw = value?.trim()
  if (!raw) throw new Error('게시 차단: 유효한 제휴 상품 링크가 없습니다.')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('게시 차단: 제휴 링크 형식이 올바르지 않습니다.')
  }

  if (url.protocol !== 'https:') throw new Error('게시 차단: HTTPS 제휴 링크만 사용할 수 있습니다.')

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const coupangValid = host === 'link.coupang.com' && !!url.pathname && url.pathname !== '/'
  const amazonHosts = new Set(['amazon.com', 'amazon.co.jp', 'amazon.co.uk', 'amazon.de', 'amazon.com.au'])
  const amazonValid = amazonHosts.has(host) && !!url.searchParams.get('tag')
  if (!coupangValid && !amazonValid) {
    throw new Error('게시 차단: 검증된 쿠팡 딥링크 또는 Associate tag가 포함된 Amazon 링크가 필요합니다.')
  }

  return url.toString()
}

export function buildTrackedAffiliateUrl(contentId: number, productId: number): string {
  if (!Number.isInteger(contentId) || contentId <= 0 || !Number.isInteger(productId) || productId <= 0) {
    throw new Error('추적 링크 생성 차단: 유효한 콘텐츠/상품 ID가 필요합니다.')
  }
  const rawBase = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!rawBase) throw new Error('추적 링크 생성 차단: NEXT_PUBLIC_APP_URL이 필요합니다.')
  const base = new URL(rawBase)
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
    throw new Error('추적 링크 생성 차단: 운영 URL은 HTTPS여야 합니다.')
  }
  const tracked = new URL('/api/tracking/click', base)
  tracked.searchParams.set('c', String(contentId))
  tracked.searchParams.set('p', String(productId))
  return tracked.toString()
}
