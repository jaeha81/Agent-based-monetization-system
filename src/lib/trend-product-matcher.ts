import { execute, query } from '@/lib/db'

export interface TrendSignal { keyword: string; score: number; views: number }
export interface TrendVideoSignal { title: string; views: number; shoppingRelevant: boolean }

const normalize = (value: string) => value.toLowerCase().replace(/[^0-9a-z가-힣ぁ-んァ-ヶ一-龯äöüß]+/g, ' ').trim()
const terms = (value: string) => normalize(value).split(/\s+/).filter(term => term.length >= 2)

function overlaps(productText: string, signalText: string): boolean {
  const productTerms = terms(productText)
  const signalTerms = terms(signalText)
  return productTerms.some(product => signalTerms.some(signal => product.includes(signal) || signal.includes(product)))
}

export function calculateTrendMatch(
  productName: string,
  category: string,
  keywords: TrendSignal[],
  videos: TrendVideoSignal[],
): { score: number; reason: string } {
  const productText = `${productName} ${category}`
  const matchedKeywords = keywords.filter(signal => overlaps(productText, signal.keyword))
  const matchedVideos = videos.filter(video => video.shoppingRelevant && overlaps(productText, video.title))
  if (!matchedKeywords.length && !matchedVideos.length) return { score: 0, reason: '최근 3일 시장 신호와 직접 연관 없음' }

  const maxKeyword = Math.max(1, ...keywords.map(signal => Math.max(0, signal.score)))
  const keywordStrength = matchedKeywords.reduce((sum, signal) => sum + Math.sqrt(Math.max(0, signal.score) / maxKeyword), 0)
  const keywordScore = Math.min(70, keywordStrength * 35)
  const videoStrength = matchedVideos.reduce((sum, video) => sum + Math.log10(Math.max(10, video.views)) / 7, 0)
  const videoScore = Math.min(30, videoStrength * 15)
  const score = Math.round((keywordScore + videoScore) * 100) / 100
  const evidence = [
    ...matchedKeywords.slice(0, 3).map(signal => `키워드:${signal.keyword}`),
    ...matchedVideos.slice(0, 2).map(video => `영상:${video.title.slice(0, 28)}`),
  ]
  return { score, reason: evidence.join(' · ') }
}

export async function refreshProductTrendScores(region?: string): Promise<number> {
  const regionClause = region ? 'AND region = ?' : ''
  const args = region ? [region] : []
  const [products, keywords, videos] = await Promise.all([
    query<{ id: number; name: string; category: string; target_market: string | null }>(
      `SELECT id, name, category, target_market FROM products ${region ? 'WHERE target_market = ?' : ''}`, args
    ),
    query<{ keyword: string; score: number; total_views: number; region: string }>(`
      SELECT keyword, MAX(score) score, MAX(total_views) total_views, region
      FROM market_trend_keywords WHERE collected_at >= datetime('now', '-3 days') ${regionClause}
      GROUP BY region, keyword ORDER BY score DESC`, args),
    query<{ title: string; view_count: number; shopping_relevant: number; region: string }>(`
      SELECT title, view_count, shopping_relevant, region FROM market_trend_videos
      WHERE collected_at >= datetime('now', '-3 days') ${regionClause}`, args),
  ])
  for (const product of products) {
    const market = product.target_market || 'KR'
    const decision = calculateTrendMatch(
      product.name, product.category,
      keywords.filter(item => item.region === market).map(item => ({ keyword: item.keyword, score: Number(item.score), views: Number(item.total_views) })),
      videos.filter(item => item.region === market).map(item => ({ title: item.title, views: Number(item.view_count), shoppingRelevant: item.shopping_relevant === 1 })),
    )
    await execute(
      `UPDATE products SET market_trend_score = ?, market_trend_reason = ?, market_trend_updated_at = datetime('now') WHERE id = ?`,
      [decision.score, decision.reason, product.id]
    )
  }
  return products.length
}
