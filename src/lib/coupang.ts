import crypto from 'crypto'

const BASE_URL = 'https://api-gateway.coupang.com'
const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY || ''
const SECRET_KEY = process.env.COUPANG_SECRET_KEY || ''
const CHANNEL_ID = process.env.COUPANG_CHANNEL_ID || ''

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
    return getCuratedProducts(keyword, limit)
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
      return getCuratedProducts(keyword, limit)
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
    return getCuratedProducts(keyword, limit)
  }
}

export async function generateAffiliateLink(
  productUrl: string,
  productId: number,
  commissionRate = 3.0
): Promise<AffiliateLink> {
  if (!ACCESS_KEY || !SECRET_KEY) {
    // 채널 ID로 실제 추적 링크 생성 (API 키 불필요)
    const trackedUrl = CHANNEL_ID
      ? `https://link.coupang.com/a/${CHANNEL_ID}?url=${encodeURIComponent(productUrl)}`
      : productUrl
    return {
      productId,
      shortUrl: trackedUrl,
      originalUrl: productUrl,
      commissionRate,
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

// 실제 쿠팡 베스트셀러 기반 바이럴 가능 큐레이션 풀 (API 없이 채널 ID 추적 링크 생성)
const CURATED_POOL: Omit<CoupangProduct, 'ratingCount'>[] = [
  // 유아 7% — 단가 높고 커미션 최고
  { productId: 2001, productName: '코니 바운서 밸런스 스트라이프 뉴본', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=코니+바운서+밸런스', originalPrice: 79000, salePrice: 69900, categoryName: '유아', rating: 4.9, commissionRate: 7.0 },
  { productId: 2002, productName: '스킵합 이지워시 범보 의자 트레이 포함', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=범보의자+트레이', originalPrice: 49000, salePrice: 38900, categoryName: '유아', rating: 4.8, commissionRate: 7.0 },
  { productId: 2003, productName: '유피아 실리콘 이유식 식판 흡착', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=실리콘+이유식+식판+흡착', originalPrice: 18000, salePrice: 13900, categoryName: '유아', rating: 4.7, commissionRate: 7.0 },
  // 스포츠 6%
  { productId: 3001, productName: '솔로 테니스 리바운더 혼자치는 테니스', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=솔로+테니스+리바운더', originalPrice: 89000, salePrice: 79000, categoryName: '스포츠', rating: 4.6, commissionRate: 6.0 },
  { productId: 3002, productName: '저항밴드 세트 5종 홈트 스쿼트', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=저항밴드+세트+홈트', originalPrice: 25000, salePrice: 17900, categoryName: '스포츠', rating: 4.7, commissionRate: 6.0 },
  { productId: 3003, productName: '폼롤러 요가 마사지 근막이완 36cm', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=폼롤러+마사지+근막이완', originalPrice: 22000, salePrice: 14900, categoryName: '스포츠', rating: 4.8, commissionRate: 6.0 },
  // 뷰티 5%
  { productId: 4001, productName: '에스트라 365 토너패드 100매 대용량', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=에스트라+토너패드+100매', originalPrice: 22000, salePrice: 17900, categoryName: '뷰티', rating: 4.8, commissionRate: 5.0 },
  { productId: 4002, productName: '라운드랩 1025 독도 토너 500ml 대용량', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=라운드랩+독도+토너+500ml', originalPrice: 18000, salePrice: 14500, categoryName: '뷰티', rating: 4.9, commissionRate: 5.0 },
  { productId: 4003, productName: '메디힐 마스크팩 10매 NMF 수분', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=메디힐+마스크팩+10매', originalPrice: 15000, salePrice: 9900, categoryName: '뷰티', rating: 4.7, commissionRate: 5.0 },
  { productId: 4004, productName: '롬앤 립틴트 13호 피그 코랄 베스트', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=롬앤+립틴트', originalPrice: 11000, salePrice: 8900, categoryName: '뷰티', rating: 4.8, commissionRate: 5.0 },
  // 생활용품 4%
  { productId: 5001, productName: '락앤락 에어 밀폐용기 4종 세트 냉장고', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=락앤락+에어+밀폐용기+4종', originalPrice: 35000, salePrice: 24900, categoryName: '생활용품', rating: 4.8, commissionRate: 4.0 },
  { productId: 5002, productName: '실리콘 주방 수납 선반 싱크대 정리', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=실리콘+싱크대+수납+선반', originalPrice: 19000, salePrice: 12900, categoryName: '생활용품', rating: 4.7, commissionRate: 4.0 },
  { productId: 5003, productName: '우라라 압축 진공 팩 8종 세트 이불', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=이불+압축+진공팩+세트', originalPrice: 28000, salePrice: 18900, categoryName: '생활용품', rating: 4.6, commissionRate: 4.0 },
  { productId: 5004, productName: '테이팩스 지퍼백 100매 대용량 냉동', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=지퍼백+100매+냉동', originalPrice: 12000, salePrice: 8900, categoryName: '생활용품', rating: 4.9, commissionRate: 4.0 },
  // 식품 3%
  { productId: 6001, productName: '동원 참치 150g 12캔 선물세트', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=동원참치+12캔', originalPrice: 32000, salePrice: 24900, categoryName: '식품', rating: 4.8, commissionRate: 3.0 },
  { productId: 6002, productName: '신라면 멀티팩 40봉 대용량 라면', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=신라면+멀티팩+40봉', originalPrice: 26000, salePrice: 19900, categoryName: '식품', rating: 4.9, commissionRate: 3.0 },
  // 전자기기 1.5%
  { productId: 7001, productName: '샤오미 미밴드 8 한국어 스마트워치', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=미밴드+8', originalPrice: 55000, salePrice: 39900, categoryName: '전자기기', rating: 4.6, commissionRate: 1.5 },
  { productId: 7002, productName: '앤커 USB C 고속충전 30W 멀티포트', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=앤커+30W+USB-C+충전기', originalPrice: 32000, salePrice: 24900, categoryName: '전자기기', rating: 4.7, commissionRate: 1.5 },
  { productId: 7003, productName: '로지텍 M650 무선마우스 사일런트', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=로지텍+M650+무선마우스', originalPrice: 49000, salePrice: 38900, categoryName: '전자기기', rating: 4.8, commissionRate: 1.5 },
  // 패션 2%
  { productId: 8001, productName: '스탠다드 코튼 기본 반팔 티셔츠 19컬러', productImage: '', productUrl: 'https://www.coupang.com/np/search?q=기본+반팔+티셔츠+코튼', originalPrice: 15000, salePrice: 9900, categoryName: '패션', rating: 4.7, commissionRate: 2.0 },
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
