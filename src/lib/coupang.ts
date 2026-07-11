import crypto from 'crypto'

const BASE_URL = 'https://api-gateway.coupang.com'
const API_PREFIX = '/v2/providers/affiliate_open_api/apis/openapi/v1'

function getCredentials(): { accessKey: string; secretKey: string } {
  return {
    accessKey: (process.env.COUPANG_ACCESS_KEY || '').replace(/^﻿/, '').trim(),
    secretKey: (process.env.COUPANG_SECRET_KEY || '').replace(/^﻿/, '').trim(),
  }
}

function generateHmacSignature(
  method: string,
  path: string,
  query: string,
  datetime: string,
  secretKey: string
): string {
  const message = datetime + method + path + query
  return crypto.createHmac('sha256', secretKey).update(message).digest('hex')
}

function buildAuthHeader(method: string, path: string, query: string): string {
  const { accessKey, secretKey } = getCredentials()
  if (!accessKey || !secretKey) throw new Error('쿠팡 API 자격증명이 설정되지 않았습니다.')
  const datetime = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(2)
  const signature = generateHmacSignature(method, path, query, datetime, secretKey)
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`
}

async function coupangRequest<T>(path: string, query = '', init?: RequestInit): Promise<T> {
  const method = init?.method || 'GET'
  const authorization = buildAuthHeader(method, path, query)
  const response = await fetch(`${BASE_URL}${path}${query ? `?${query}` : ''}`, {
    ...init,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!response.ok) throw new Error(`쿠팡 API 요청 실패 (${response.status})`)
  const payload = await response.json() as { rCode?: string | number; rMessage?: string } & T
  if (String(payload.rCode ?? '0') !== '0') throw new Error(`쿠팡 API 응답 오류 (${payload.rCode})`)
  return payload
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

export interface CoupangRevenueReportRow {
  date: string | number
  orderDate?: string | number
  trackingCode?: string
  subId?: string
  orderId: string | number
  productId: string | number
  productName: string
  quantity?: number
  gmv?: number
  commissionRate?: number
  commission: number
  categoryName?: string
}

export interface CoupangRevenueReports {
  orders: CoupangRevenueReportRow[]
  cancels: CoupangRevenueReportRow[]
}

export async function searchTrendingProducts(
  keyword: string,
  limit = 5
): Promise<CoupangProduct[]> {
  const { accessKey, secretKey } = getCredentials()
  if (!accessKey || !secretKey) {
    if (process.env.USE_MOCK_DATA === 'true') return getCuratedProducts(keyword, limit)
    throw new Error('쿠팡 상품 발굴 중단: COUPANG_ACCESS_KEY와 COUPANG_SECRET_KEY가 필요합니다.')
  }

  const path = `${API_PREFIX}/products/search`
  const params = new URLSearchParams({ keyword, limit: String(Math.max(1, Math.min(limit, 10))) })
  const subId = (process.env.COUPANG_SUB_ID || '').trim()
  if (subId) params.set('subId', subId)
  const query = params.toString()

  try {
    const data = await coupangRequest<{ data?: { productData?: Array<Record<string, unknown>> } }>(path, query)
    return (data.data?.productData || []).map((p: Record<string, unknown>) => ({
      productId: p.productId as number,
      productName: p.productName as string,
      productImage: p.productImage as string,
      productUrl: p.productUrl as string,
      originalPrice: Number(p.originalPrice || p.productPrice || 0),
      salePrice: Number(p.salePrice || p.productPrice || 0),
      categoryName: String(p.categoryName || ''),
      rating: Number(p.rating || 0),
      ratingCount: Number(p.ratingCount || 0),
      commissionRate: getCategoryCommissionRate(String(p.categoryName || '')),
    }))
  } catch (err) {
    console.error('[Coupang] 상품 검색 실패:', err instanceof Error ? err.message : 'unknown')
    throw err
  }
}

export async function generateAffiliateLink(
  productUrl: string,
  productId: number,
  commissionRate = 3.0
): Promise<AffiliateLink> {
  const { accessKey, secretKey } = getCredentials()
  if (!accessKey || !secretKey) {
    throw new Error('쿠팡 딥링크 생성 중단: 파트너스 API 키가 필요합니다.')
  }

  const path = `${API_PREFIX}/deeplink`
  const subId = (process.env.COUPANG_SUB_ID || '').trim()
  const body = JSON.stringify({ coupangUrls: [productUrl], ...(subId ? { subId } : {}) })

  try {
    const data = await coupangRequest<{ data?: Array<{ shortenUrl?: string; originalUrl?: string }> }>(path, '', {
      method: 'POST',
      body,
    })
    const link = data.data?.[0]
    return {
      productId,
      shortUrl: link?.shortenUrl || (() => { throw new Error('쿠팡 딥링크 응답에 shortenUrl이 없습니다.') })(),
      originalUrl: productUrl,
      commissionRate,
    }
  } catch (err) {
    console.error('[Coupang] 딥링크 생성 실패:', err instanceof Error ? err.message : 'unknown')
    throw err
  }
}

function toReportDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('쿠팡 리포트 날짜는 YYYY-MM-DD 형식이어야 합니다.')
  return value.replace(/-/g, '')
}

async function fetchRevenueReport(
  type: 'orders' | 'cancels',
  startDate: string,
  endDate: string
): Promise<CoupangRevenueReportRow[]> {
  const path = `${API_PREFIX}/reports/${type}`
  const rows: CoupangRevenueReportRow[] = []
  const subId = (process.env.COUPANG_SUB_ID || '').trim()

  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      startDate: toReportDate(startDate),
      endDate: toReportDate(endDate),
      page: String(page),
    })
    if (subId) params.set('subId', subId)
    const payload = await coupangRequest<{ data?: CoupangRevenueReportRow[] }>(path, params.toString())
    const pageRows = Array.isArray(payload.data) ? payload.data : []
    rows.push(...pageRows)
    if (pageRows.length < 1000) break
  }

  return rows
}

export async function getCoupangRevenueReports(startDate: string, endDate: string): Promise<CoupangRevenueReports> {
  const from = new Date(`${startDate}T00:00:00Z`)
  const to = new Date(`${endDate}T00:00:00Z`)
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000)
  if (!Number.isFinite(days) || days < 0 || days > 30) {
    throw new Error('쿠팡 리포트 조회 기간은 최대 31일입니다.')
  }
  const [orders, cancels] = await Promise.all([
    fetchRevenueReport('orders', startDate, endDate),
    fetchRevenueReport('cancels', startDate, endDate),
  ])
  return { orders, cancels }
}

export async function verifyCoupangCredentials(): Promise<{ ok: boolean; reports: boolean; reason?: string }> {
  const { accessKey, secretKey } = getCredentials()
  if (!accessKey || !secretKey) return { ok: false, reports: false, reason: 'missing' }
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  try {
    await fetchRevenueReport('orders', yesterday, yesterday)
    return { ok: true, reports: true }
  } catch (error) {
    return {
      ok: false,
      reports: false,
      reason: error instanceof Error && /\((401|403)\)/.test(error.message) ? 'invalid' : 'unavailable',
    }
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

// 실제 쿠팡 베스트셀러 기반 바이럴 가능 큐레이션 풀 (API 없이 채널 ID 추적 링크 생성)
const CURATED_POOL: Omit<CoupangProduct, 'ratingCount'>[] = [
  // 유아 7% — 단가 높고 커미션 최고
  { productId: 2001, productName: '포맘스 스마트 바운서 멀티스윙 신생아 바운서', productImage: '', productUrl: 'https://www.coupang.com/vp/products/7158777931', originalPrice: 239000, salePrice: 189000, categoryName: '유아', rating: 4.7, commissionRate: 7.0 },
  { productId: 2002, productName: '아기 유아 식탁의자 하이체어 트레이 포함 높이조절', productImage: '', productUrl: 'https://www.coupang.com/vp/products/7865804529', originalPrice: 89000, salePrice: 59000, categoryName: '유아', rating: 4.6, commissionRate: 7.0 },
  { productId: 2003, productName: '모윰 실리콘 이유식 식판 흡착', productImage: '', productUrl: 'https://www.coupang.com/vp/products/1300547723', originalPrice: 18000, salePrice: 13900, categoryName: '유아', rating: 4.7, commissionRate: 7.0 },
  // 스포츠 6%
  { productId: 3001, productName: '솔로 테니스 리바운더 혼자치는 테니스', productImage: '', productUrl: 'https://www.coupang.com/vp/products/8027969106', originalPrice: 89000, salePrice: 79000, categoryName: '스포츠', rating: 4.6, commissionRate: 6.0 },
  { productId: 3002, productName: '저항밴드 5단계 세트 홈트 스쿼트', productImage: '', productUrl: 'https://www.coupang.com/vp/products/7342093146', originalPrice: 25000, salePrice: 17900, categoryName: '스포츠', rating: 4.7, commissionRate: 6.0 },
  { productId: 3003, productName: '폼롤러 EPP 마사지 근막이완 36cm', productImage: '', productUrl: 'https://www.coupang.com/vp/products/24941844', originalPrice: 22000, salePrice: 14900, categoryName: '스포츠', rating: 4.8, commissionRate: 6.0 },
  // 뷰티 5%
  { productId: 4001, productName: '에스트라 에이시카 365 쿨링 토너패드 100매', productImage: '', productUrl: 'https://www.coupang.com/vp/products/8398285387', originalPrice: 22000, salePrice: 17900, categoryName: '뷰티', rating: 4.8, commissionRate: 5.0 },
  { productId: 4002, productName: '라운드랩 독도 토너 500ml 대용량', productImage: '', productUrl: 'https://www.coupang.com/vp/products/1414809213', originalPrice: 18000, salePrice: 14500, categoryName: '뷰티', rating: 4.9, commissionRate: 5.0 },
  { productId: 4003, productName: '메디힐 NMF 아쿠아링 마스크팩 10매', productImage: '', productUrl: 'https://www.coupang.com/vp/products/17411242', originalPrice: 15000, salePrice: 9900, categoryName: '뷰티', rating: 4.7, commissionRate: 5.0 },
  { productId: 4004, productName: '롬앤 쥬시 래스팅 틴트', productImage: '', productUrl: 'https://www.coupang.com/vp/products/6379919384', originalPrice: 11000, salePrice: 8900, categoryName: '뷰티', rating: 4.8, commissionRate: 5.0 },
  // 생활용품 4%
  { productId: 5001, productName: '락앤락 스마트킵 밀폐용기 세트', productImage: '', productUrl: 'https://www.coupang.com/vp/products/8087449100', originalPrice: 35000, salePrice: 24900, categoryName: '생활용품', rating: 4.8, commissionRate: 4.0 },
  { productId: 5002, productName: '싱크대 하부장 냄비 수납 선반', productImage: '', productUrl: 'https://www.coupang.com/vp/products/7907810917', originalPrice: 19000, salePrice: 12900, categoryName: '생활용품', rating: 4.7, commissionRate: 4.0 },
  { productId: 5003, productName: '이불 압축 진공팩 세트', productImage: '', productUrl: 'https://www.coupang.com/vp/products/9473187277', originalPrice: 28000, salePrice: 18900, categoryName: '생활용품', rating: 4.6, commissionRate: 4.0 },
  { productId: 5004, productName: '크린랩 냉동 지퍼백 대용량 100매', productImage: '', productUrl: 'https://www.coupang.com/vp/products/315174424', originalPrice: 12000, salePrice: 8900, categoryName: '생활용품', rating: 4.9, commissionRate: 4.0 },
  // 식품 3%
  { productId: 6001, productName: '동원 참치 150g 선물세트', productImage: '', productUrl: 'https://www.coupang.com/vp/products/2042132', originalPrice: 32000, salePrice: 24900, categoryName: '식품', rating: 4.8, commissionRate: 3.0 },
  { productId: 6002, productName: '신라면 멀티팩 40봉 대용량', productImage: '', productUrl: 'https://www.coupang.com/vp/products/8107799437', originalPrice: 26000, salePrice: 19900, categoryName: '식품', rating: 4.9, commissionRate: 3.0 },
  // 전자기기 1.5%
  { productId: 7001, productName: '샤오미 미밴드 8 스마트밴드', productImage: '', productUrl: 'https://www.coupang.com/vp/products/7595564046', originalPrice: 55000, salePrice: 39900, categoryName: '전자기기', rating: 4.6, commissionRate: 1.5 },
  { productId: 7002, productName: '앤커 나노 USB-C 고속충전기', productImage: '', productUrl: 'https://www.coupang.com/vp/products/6810349565', originalPrice: 32000, salePrice: 24900, categoryName: '전자기기', rating: 4.7, commissionRate: 1.5 },
  { productId: 7003, productName: '로지텍 M650 무선마우스 사일런트', productImage: '', productUrl: 'https://www.coupang.com/vp/products/7310195790', originalPrice: 49000, salePrice: 38900, categoryName: '전자기기', rating: 4.8, commissionRate: 1.5 },
  // 패션 2%
  { productId: 8001, productName: '유니클로 남성 에어리즘 코튼 오버사이즈 반팔 티셔츠', productImage: '', productUrl: 'https://www.coupang.com/vp/products/7962160729', originalPrice: 24900, salePrice: 19900, categoryName: '패션', rating: 4.8, commissionRate: 2.0 },
]

function getCuratedProducts(keyword: string, limit: number): CoupangProduct[] {
  // 키워드로 카테고리 매칭 → 해당 카테고리 우선 정렬
  const CATEGORY_KEYWORDS: Record<string, string[]> = {
    '유아': ['유아', '아기', '육아', '이유식', '바운서', '범보'],
    '스포츠': ['스포츠', '운동', '홈트', '테니스', '요가', '헬스'],
    '뷰티': ['뷰티', '스킨케어', '화장품', '마스크팩', '토너', '립'],
    '생활용품': ['생활', '수납', '주방', '압축', '정리', '다이소'],
    '식품': ['식품', '라면', '참치', '음식', '간식', '건강식'],
    '전자기기': ['전자', '충전기', '마우스', '키보드', '스마트', '가전'],
    '패션': ['패션', '옷', '티셔츠', '의류'],
  }

  const lowerKeyword = keyword.toLowerCase()
  const matchedCategory = Object.entries(CATEGORY_KEYWORDS).find(([, keywords]) =>
    keywords.some(k => lowerKeyword.includes(k))
  )?.[0]

  // 매칭 카테고리 먼저, 나머지는 수수료율 내림차순
  const sorted = [...CURATED_POOL].sort((a, b) => {
    if (matchedCategory) {
      if (a.categoryName === matchedCategory && b.categoryName !== matchedCategory) return -1
      if (b.categoryName === matchedCategory && a.categoryName !== matchedCategory) return 1
    }
    return b.commissionRate - a.commissionRate
  })

  return sorted.slice(0, limit).map(p => ({
    ...p,
    ratingCount: 0,
  }))
}
