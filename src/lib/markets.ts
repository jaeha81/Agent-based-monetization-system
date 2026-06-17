export type Market = 'KR' | 'US' | 'JP' | 'GB' | 'DE' | 'AU'

export interface MarketConfig {
  market: Market
  language: string
  currency: string
  affiliateProgram: 'coupang' | 'amazon'
  amazonDomain?: string
  platforms: string[]
  trendKeywords: string[]
}

export const MARKETS: Record<Market, MarketConfig> = {
  KR: {
    market: 'KR', language: 'ko', currency: 'KRW',
    affiliateProgram: 'coupang',
    platforms: ['YouTube', 'Instagram', 'TikTok', 'Naver', 'Threads', 'Facebook'],
    trendKeywords: ['다이소 신상', '뷰티 추천', '육아 필수템', '운동 용품', '핫템', '셀럽 추천'],
  },
  US: {
    market: 'US', language: 'en', currency: 'USD',
    affiliateProgram: 'amazon', amazonDomain: 'amazon.com',
    platforms: ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Pinterest', 'Twitter'],
    trendKeywords: ['amazon finds', 'tiktok made me buy it', 'beauty essentials', 'home gadgets', 'fitness gear', 'under $20'],
  },
  JP: {
    market: 'JP', language: 'ja', currency: 'JPY',
    affiliateProgram: 'amazon', amazonDomain: 'amazon.co.jp',
    platforms: ['YouTube', 'Instagram', 'TikTok', 'Twitter', 'LINE', 'Facebook'],
    trendKeywords: ['プチプラ', 'おすすめ商品', '美容グッズ', 'キッチン用品', 'ダイエット', 'ガジェット'],
  },
  GB: {
    market: 'GB', language: 'en', currency: 'GBP',
    affiliateProgram: 'amazon', amazonDomain: 'amazon.co.uk',
    platforms: ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Pinterest'],
    trendKeywords: ['amazon uk finds', 'beauty must haves', 'home essentials', 'gym gear', 'gadgets under £20'],
  },
  DE: {
    market: 'DE', language: 'de', currency: 'EUR',
    affiliateProgram: 'amazon', amazonDomain: 'amazon.de',
    platforms: ['YouTube', 'Instagram', 'TikTok', 'Facebook'],
    trendKeywords: ['Amazon Finds', 'Beauty Empfehlung', 'Küchengadgets', 'Fitness', 'Schnäppchen'],
  },
  AU: {
    market: 'AU', language: 'en', currency: 'AUD',
    affiliateProgram: 'amazon', amazonDomain: 'amazon.com.au',
    platforms: ['YouTube', 'Instagram', 'TikTok', 'Facebook'],
    trendKeywords: ['amazon australia', 'beauty picks', 'home finds', 'fitness', 'gadgets'],
  },
}

export function getActiveMarkets(): Market[] {
  const env = process.env.TARGET_MARKETS || 'KR'
  return env.split(',').map(m => m.trim().toUpperCase() as Market).filter(m => m in MARKETS)
}

export function buildAffiliateUrl(query: string, market: Market, productUrl?: string): string {
  const cfg = MARKETS[market]
  if (cfg.affiliateProgram === 'coupang') {
    return productUrl || `https://coupa.ng/search?keyword=${encodeURIComponent(query)}`
  }
  const domain = cfg.amazonDomain || 'amazon.com'
  const tag = process.env[`AMAZON_ASSOCIATE_TAG_${market}`]
  const tagParam = tag ? `&tag=${tag}` : ''
  return `https://www.${domain}/s?k=${encodeURIComponent(query)}${tagParam}`
}

export function getAffiliateDisclosure(language: string): string {
  const map: Record<string, string> = {
    ko: '※ 이 콘텐츠는 제휴 마케팅 활동의 일환으로 소정의 수수료를 제공받을 수 있습니다.',
    en: '⚠️ This post contains affiliate links. I earn a commission at no extra cost to you. #ad #affiliate',
    ja: '※ 本コンテンツにはアフィリエイトリンクが含まれており、購入時に手数料を受け取る場合があります。',
    de: '⚠️ Dieser Beitrag enthält Affiliate-Links. Ich erhalte eine Provision ohne Mehrkosten für Sie. #Werbung',
  }
  return map[language] || map['en']
}
