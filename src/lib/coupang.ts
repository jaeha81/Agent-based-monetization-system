import crypto from 'crypto'

const BASE_URL = 'https://api-gateway.coupang.com'
const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY || ''
const SECRET_KEY = process.env.COUPANG_SECRET_KEY || ''
const CHANNEL_ID = process.env.COUPANG_CHANNEL_ID || 'AF5520196'

function generateHmacSignature(
  method: string,
  path: string,
  query: string,
  datetime: string
): string {
  const message = datetime + method + path + query
  return crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex')
}

function buildAuthHeader(method: string, path: string, query: string): string {
  const datetime = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const signature = generateHmacSignature(method, path, query, datetime)
  return `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`
}

export interface CoupangProduct {
  productId: number
  productName: string
  productImage: string
  productUrl: string
  originalPrice: number
  salePrice: number
  categoryName: string
  rating: number
  ratingCount: number
  commissionRate: number
}

export interface AffiliateLink {
  productId: number
  shortUrl: string
  originalUrl: string
  commissionRate: number
}

export async function searchTrendingProducts(
  keyword: string,
  limit = 5
): Promise<CoupangProduct[]> {
  if (!ACCESS_KEY || !SECRET_KEY) {
    return getMockProducts(keyword, limit)
  }

  const path = '/v2/providers/affiliate_open_api/apis/openapi/products/search'
  const query = `keyword=${encodeURIComponent(keyword)}&limit=${limit}`
  const auth = buildAuthHeader('GET', path, query)

  try {
    const res = await fetch(`${BASE_URL}${path}?${query}`, {
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      console.error('[Coupang] Search failed:', res.status, await res.text())
      return getMockProducts(keyword, limit)
    }

    const data = await res.json()
    return (data.data?.productData || []).map((p: Record<string, unknown>) => ({
      productId: p.productId as number,
      productName: p.productName as string,
      productImage: p.productImage as string,
      productUrl: p.productUrl as string,
      originalPrice: p.originalPrice as number,
      salePrice: p.salePrice as number,
      categoryName: p.categoryName as string,
      rating: p.rating as number,
      ratingCount: p.ratingCount as number,
      commissionRate: getCategoryCommissionRate(p.categoryName as string),
    }))
  } catch (err) {
    console.error('[Coupang] Error:', err)
    return getMockProducts(keyword, limit)
  }
}

export async function generateAffiliateLink(
  productUrl: string,
  productId: number
): Promise<AffiliateLink> {
  if (!ACCESS_KEY || !SECRET_KEY) {
    // 채널 ID로 실제 추적 링크 생성 (API 키 불필요)
    const trackedUrl = `https://link.coupang.com/a/${CHANNEL_ID}?url=${encodeURIComponent(productUrl)}`
    return {
      productId,
      shortUrl: trackedUrl,
      originalUrl: productUrl,
      commissionRate: 3.0,
    }
  }

  const path = '/v2/providers/affiliate_open_api/apis/openapi/deeplink'
  const body = JSON.stringify({ coupangUrls: [productUrl] })
  const auth = buildAuthHeader('POST', path, '')

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body,
    })

    if (!res.ok) {
      console.error('[Coupang] Deeplink failed:', res.status)
      return { productId, shortUrl: productUrl, originalUrl: productUrl, commissionRate: 3.0 }
    }

    const data = await res.json()
    const link = data.data?.[0]
    return {
      productId,
      shortUrl: link?.shortenUrl || productUrl,
      originalUrl: productUrl,
      commissionRate: getCategoryCommissionRate(''),
    }
  } catch (err) {
    console.error('[Coupang] Deeplink error:', err)
    return { productId, shortUrl: productUrl, originalUrl: productUrl, commissionRate: 3.0 }
  }
}

export function getCategoryCommissionRate(category: string): number {
  const rates: Record<string, number> = {
    '뷰티': 5.0,
    '식품': 3.0,
    '패션': 2.0,
    '유아': 7.0,
    '스포츠': 6.0,
    '전자기기': 1.5,
    '생활용품': 4.0,
  }
  for (const [key, rate] of Object.entries(rates)) {
    if (category.includes(key)) return rate
  }
  return 3.0
}

function getMockProducts(keyword: string, limit: number): CoupangProduct[] {
  const templates = [
    { name: '다이소 수납 압축백 대형', category: '생활용품', price: 2000, commissionRate: 4.0, rating: 4.8 },
    { name: `${keyword} 인기 뷰티템`, category: '뷰티', price: 28000, commissionRate: 5.0, rating: 4.7 },
    { name: '솔로 테니스 리바운더', category: '스포츠', price: 89000, commissionRate: 6.0, rating: 4.6 },
    { name: '아이코닉 센서리 토이 세트', category: '유아', price: 35000, commissionRate: 7.0, rating: 4.9 },
    { name: '에스트라 토너패드 100매', category: '뷰티', price: 18000, commissionRate: 5.0, rating: 4.8 },
  ]
  return templates.slice(0, limit).map((t, i) => ({
    productId: 1000000 + i,
    productName: t.name,
    productImage: `https://via.placeholder.com/300x300?text=${encodeURIComponent(t.name)}`,
    productUrl: `https://www.coupang.com/vp/products/${1000000 + i}`,
    originalPrice: t.price,
    salePrice: Math.floor(t.price * 0.9),
    categoryName: t.category,
    rating: t.rating,
    ratingCount: Math.floor(Math.random() * 5000) + 500,
    commissionRate: t.commissionRate,
  }))
}
