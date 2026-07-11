import { execute, queryOne } from '@/lib/db'

const STOP_WORDS = new Set(['shorts', 'youtube', 'official', 'video', 'feat', 'the', 'and', 'with', '에서', '하는', '이거', '진짜'])
const SHOPPING_HINTS: Record<string, string[]> = {
  KR: ['추천', '리뷰', '신상', '제품', '상품', '구매', '언박싱', '하울', '뷰티', '생활', '가전', '육아', '운동', '패션', '핫템'],
  US: ['review', 'unboxing', 'amazon finds', 'must have', 'buy', 'gadget', 'beauty', 'haul'],
  GB: ['review', 'unboxing', 'amazon finds', 'must have', 'buy', 'gadget', 'beauty', 'haul'],
  AU: ['review', 'unboxing', 'amazon finds', 'must have', 'buy', 'gadget', 'beauty', 'haul'],
  JP: ['おすすめ', 'レビュー', '新商品', '購入', '開封', '美容', '家電', '便利グッズ'],
  DE: ['test', 'bewertung', 'neuheit', 'kaufen', 'unboxing', 'amazon fund', 'gerät', 'beauty'],
}

export async function syncYouTubeMarketTrends(regionCode = 'KR'): Promise<{ videos: number; keywords: string[] }> {
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
  if (!apiKey) return { videos: 0, keywords: [] }
  await execute(`DELETE FROM market_trend_snapshots WHERE collected_at < datetime('now', '-30 days')`)
  const params = new URLSearchParams({
    part: 'snippet,statistics', chart: 'mostPopular', regionCode, maxResults: '50', key: apiKey,
  })
  const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`)
  if (!response.ok) throw new Error(`YouTube 인기 영상 조회 실패: ${response.status}`)
  const data = await response.json() as { items?: Array<{ id: string; snippet?: { title?: string; tags?: string[]; categoryId?: string }; statistics?: { viewCount?: string; likeCount?: string } }> }
  const counts = new Map<string, { count: number; views: number; velocity: number }>()
  const shoppingHints = SHOPPING_HINTS[regionCode] || SHOPPING_HINTS.US

  for (const item of data.items || []) {
    const title = item.snippet?.title || ''
    const views = Number(item.statistics?.viewCount || 0)
    const likes = Number(item.statistics?.likeCount || 0)
    const previous = await queryOne<{ view_count: number; collected_at: string }>(`
      SELECT view_count, collected_at FROM market_trend_snapshots
      WHERE source = 'youtube' AND region = ? AND external_id = ?
      ORDER BY collected_at DESC LIMIT 1
    `, [regionCode, item.id])
    const elapsedHours = previous ? Math.max(0, (Date.now() - new Date(previous.collected_at).getTime()) / 3_600_000) : 0
    const viewVelocity = previous && elapsedHours >= 1
      ? Math.max(0, views - Number(previous.view_count || 0)) / elapsedHours
      : 0
    await execute(`INSERT INTO market_trend_snapshots
      (source, region, external_id, view_count, like_count, collected_at)
      VALUES ('youtube', ?, ?, ?, ?, datetime('now'))`, [regionCode, item.id, views, likes])
    const tokens = `${title} ${(item.snippet?.tags || []).join(' ')}`
      .replace(/[^0-9A-Za-z가-힣\s]/g, ' ').split(/\s+/)
      .map(token => token.toLowerCase()).filter(token => token.length >= 2 && !STOP_WORDS.has(token))
    const normalizedTitle = title.toLowerCase()
    const shoppingRelevant = shoppingHints.some(hint => normalizedTitle.includes(hint) || tokens.some(token => token.includes(hint)))
    if (shoppingRelevant) for (const keyword of Array.from(new Set(tokens.slice(0, 20)))) {
      const current = counts.get(keyword) || { count: 0, views: 0, velocity: 0 }
      counts.set(keyword, { count: current.count + 2, views: current.views + views, velocity: current.velocity + viewVelocity })
    }
    await execute(`INSERT OR REPLACE INTO market_trend_videos
      (source, region, external_id, title, view_count, like_count, shopping_relevant, view_velocity, collected_at)
      VALUES ('youtube', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [regionCode, item.id, title, views, likes, shoppingRelevant ? 1 : 0, viewVelocity])
  }
  const signalScore = (signal: { count: number; views: number; velocity: number }) =>
    signal.count * Math.log10(signal.views + 10) + Math.log10(signal.velocity + 1) * 8
  const ranked = Array.from(counts.entries()).sort((a, b) => signalScore(b[1]) - signalScore(a[1])).slice(0, 20)
  for (const [keyword, score] of ranked) {
    await execute(`INSERT INTO market_trend_keywords (keyword, region, source, signal_count, total_views, score, growth_score, collected_at)
      VALUES (?, ?, 'youtube', ?, ?, ?, ?, datetime('now'))`,
      [keyword, regionCode, score.count, score.views, signalScore(score), Math.log10(score.velocity + 1) * 8])
  }
  return { videos: data.items?.length || 0, keywords: ranked.map(([keyword]) => keyword) }
}
