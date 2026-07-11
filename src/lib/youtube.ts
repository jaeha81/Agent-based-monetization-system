const YT_API = 'https://www.googleapis.com/youtube/v3'
const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos'
const YT_ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

class YouTubeCredentialError extends Error {
  constructor(public readonly status: number) {
    super(`YouTube credential request failed (${status})`)
  }
}

export interface YouTubeUploadOptions {
  title: string
  description: string
  tags: string[]
  videoFilePath?: string
  videoUrl?: string
  madeForKids?: boolean
  privacyStatus?: 'public' | 'private' | 'unlisted'
}

export interface YouTubeVideoResult {
  videoId: string
  url: string
  title: string
  status: string
}

function stripBom(s: string): string {
  return s.replace(/^﻿/, '').trim()
}

async function refreshAccessToken(): Promise<string> {
  const clientId = stripBom(process.env.YOUTUBE_CLIENT_ID || '')
  const clientSecret = stripBom(process.env.YOUTUBE_CLIENT_SECRET || '')
  const refreshToken = stripBom(process.env.YOUTUBE_REFRESH_TOKEN || '')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('YouTube OAuth 자격증명이 설정되지 않았습니다.')
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    throw new YouTubeCredentialError(res.status)
  }

  const data = await res.json() as { access_token?: string }
  const accessToken = stripBom(String(data.access_token || ''))
  if (!accessToken) throw new YouTubeCredentialError(401)
  return accessToken
}

export async function uploadYouTubeShorts(
  opts: YouTubeUploadOptions,
  videoBuffer: Buffer
): Promise<YouTubeVideoResult> {
  const accessToken = await refreshAccessToken()

  const metadata = {
    snippet: {
      title: opts.title.slice(0, 100),
      description: opts.description.slice(0, 5000),
      tags: [...(opts.tags || []), 'AI생성', 'AI콘텐츠'].slice(0, 30),
      categoryId: '22',
      defaultLanguage: 'ko',
    },
    status: {
      privacyStatus: opts.privacyStatus || 'private',
      selfDeclaredMadeForKids: opts.madeForKids || false,
      containsSyntheticMedia: true,
      paidProductPlacementDetails: { hasPaidProductPlacement: true },
    },
  }

  const boundary = '==youtube_boundary=='
  const delimiter = `\r\n--${boundary}\r\n`
  const closeDelim = `\r\n--${boundary}--`

  const metaPart = Buffer.from(
    `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}${delimiter}Content-Type: video/mp4\r\n\r\n`
  )
  const body = Buffer.concat([metaPart, videoBuffer, Buffer.from(closeDelim)])

  const res = await fetch(`${YT_UPLOAD}?uploadType=multipart&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`YouTube 업로드 실패: ${err}`)
  }

  const data = await res.json()
  return {
    videoId: data.id,
    url: `https://www.youtube.com/shorts/${data.id}`,
    title: opts.title,
    status: data.status?.uploadStatus || 'uploaded',
  }
}

export async function updateVideoMetadata(
  videoId: string,
  update: { title?: string; description?: string; tags?: string[] }
): Promise<void> {
  const accessToken = await refreshAccessToken()

  const res = await fetch(`${YT_API}/videos?part=snippet`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: videoId,
      snippet: {
        ...update,
        categoryId: '22',
        defaultLanguage: 'ko',
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`YouTube 메타데이터 업데이트 실패: ${err}`)
  }
}

export async function patchVideoNotForKids(videoId: string): Promise<void> {
  const accessToken = await refreshAccessToken()

  const res = await fetch(`${YT_API}/videos?part=status`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: videoId,
      status: { selfDeclaredMadeForKids: false },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`YouTube 상태 업데이트 실패 (${videoId}): ${err}`)
  }
}

export async function updateVideoPrivacy(
  videoId: string,
  privacyStatus: 'public' | 'private' | 'unlisted'
): Promise<void> {
  const accessToken = await refreshAccessToken()
  const res = await fetch(`${YT_API}/videos?part=status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: videoId,
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
        paidProductPlacementDetails: { hasPaidProductPlacement: true },
      },
    }),
  })
  if (!res.ok) throw new Error(`YouTube 공개 상태 변경 실패: ${await res.text()}`)
}

export async function deleteYouTubeVideo(videoId: string): Promise<void> {
  const accessToken = await refreshAccessToken()

  const res = await fetch(`${YT_API}/videos?id=${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // 성공 시 204 No Content
  if (!res.ok && res.status !== 204) {
    const err = await res.text()
    throw new Error(`YouTube 영상 삭제 실패 (${videoId}): ${err}`)
  }
}

export async function getChannelStats(): Promise<{
  subscriberCount: number
  viewCount: number
  videoCount: number
}> {
  const accessToken = await refreshAccessToken()
  const channelId = process.env.YOUTUBE_CHANNEL_ID || 'mine'

  const param = channelId === 'mine' ? 'mine=true' : `id=${channelId}`
  const res = await fetch(`${YT_API}/channels?part=statistics&${param}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    return { subscriberCount: 0, viewCount: 0, videoCount: 0 }
  }

  const data = await res.json()
  const stats = data.items?.[0]?.statistics || {}
  return {
    subscriberCount: parseInt(stats.subscriberCount || '0'),
    viewCount: parseInt(stats.viewCount || '0'),
    videoCount: parseInt(stats.videoCount || '0'),
  }
}

export async function getVideoStats(videoId: string): Promise<{ viewCount: number; likeCount: number; commentCount: number }> {
  const accessToken = await refreshAccessToken()
  const res = await fetch(
    `${YT_API}/videos?part=statistics&id=${videoId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) return { viewCount: 0, likeCount: 0, commentCount: 0 }
  const data = await res.json()
  const stats = data.items?.[0]?.statistics || {}
  return {
    viewCount: parseInt(stats.viewCount || '0'),
    likeCount: parseInt(stats.likeCount || '0'),
    commentCount: parseInt(stats.commentCount || '0'),
  }
}

export function buildShortsDescription(
  hookOrScript: string,
  affiliateUrl: string,
  hashtags: string[]
): string {
  // @everyday-c 스타일: 훅 → 링크 → 해시태그 → 공시
  const tagLine = hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')
  return [
    hookOrScript.slice(0, 150),
    '',
    '✅ 지금 최저가 확인 👇',
    affiliateUrl,
    '',
    '⏰ 오늘만 이 가격! 서두르세요',
    '',
    tagLine,
    '',
    '※ 이 영상은 쿠팡 파트너스 활동의 일환으로 수수료를 받을 수 있습니다.',
    '※ AI(인공지능)로 생성된 콘텐츠입니다.',
  ].join('\n')
}

// 유튜브 쇼츠 설명란 URL은 클릭 불가 → 고정 댓글로 클릭 가능한 구매 링크 제공
export async function postTopComment(videoId: string, text: string): Promise<string | null> {
  try {
    const accessToken = await refreshAccessToken()
    const res = await fetch(`${YT_API}/commentThreads?part=snippet`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          videoId,
          topLevelComment: {
            snippet: { textOriginal: text },
          },
        },
      }),
    })
    if (!res.ok) {
      console.warn('[YouTube] 댓글 게시 실패 (scope 부족일 수 있음):', await res.text())
      return null
    }
    const data = await res.json()
    return data.id as string
  } catch (e) {
    console.warn('[YouTube] 댓글 게시 오류:', e)
    return null
  }
}

export interface YouTubeAnalyticsDay {
  date: string
  views: number
  estimatedMinutesWatched: number
  estimatedRevenue: number
}

export type YouTubeRevenueStatus = 'ok' | 'missing' | 'auth_error' | 'monetary_scope_unavailable' | 'api_error'

export interface YouTubeAnalyticsRevenueResult {
  rows: YouTubeAnalyticsDay[]
  totalRevenue: number
  totalViews: number
  hasMonetization: boolean
  status: YouTubeRevenueStatus
  currency: 'KRW'
  dataThrough: string | null
}

function emptyRevenueResult(status: YouTubeRevenueStatus): YouTubeAnalyticsRevenueResult {
  return {
    rows: [],
    totalRevenue: 0,
    totalViews: 0,
    hasMonetization: false,
    status,
    currency: 'KRW',
    dataThrough: null,
  }
}

export async function getYouTubeAnalyticsRevenue(
  startDate: string,
  endDate: string
): Promise<YouTubeAnalyticsRevenueResult> {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET || !process.env.YOUTUBE_REFRESH_TOKEN) {
    return emptyRevenueResult('missing')
  }
  try {
    const accessToken = await refreshAccessToken()
    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,estimatedRevenue',
      dimensions: 'day',
      sort: 'day',
      currency: 'KRW',
    })
    const res = await fetch(`${YT_ANALYTICS_API}/reports?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (res.status === 401) return emptyRevenueResult('auth_error')
    if (res.status === 403) return emptyRevenueResult('monetary_scope_unavailable')
    if (!res.ok) return emptyRevenueResult('api_error')

    const data = await res.json() as {
      columnHeaders?: Array<{ name: string }>
      rows?: Array<Array<string | number>>
    }
    const indexes = new Map((data.columnHeaders || []).map((header, index) => [header.name, index]))
    const required = ['day', 'views', 'estimatedMinutesWatched', 'estimatedRevenue']
    if (required.some(name => !indexes.has(name))) return emptyRevenueResult('api_error')
    const rows: YouTubeAnalyticsDay[] = (data.rows || []).map(row => ({
      date: String(row[indexes.get('day')!] || ''),
      views: Number(row[indexes.get('views')!] || 0),
      estimatedMinutesWatched: Number(row[indexes.get('estimatedMinutesWatched')!] || 0),
      estimatedRevenue: Math.round(Number(row[indexes.get('estimatedRevenue')!] || 0)),
    }))
    const totalRevenue = rows.reduce((s, r) => s + r.estimatedRevenue, 0)
    const totalViews = rows.reduce((s, r) => s + r.views, 0)
    return {
      rows,
      totalRevenue,
      totalViews,
      hasMonetization: true,
      status: 'ok',
      currency: 'KRW',
      dataThrough: rows.at(-1)?.date || null,
    }
  } catch (error) {
    return emptyRevenueResult(error instanceof YouTubeCredentialError ? 'auth_error' : 'api_error')
  }
}

export interface YouTubeVideoRevenueDay {
  date: string
  videoId: string
  estimatedRevenue: number
}

export async function getYouTubeVideoRevenueAnalytics(
  videoIds: string[],
  startDate: string,
  endDate: string
): Promise<{ rows: YouTubeVideoRevenueDay[]; status: YouTubeRevenueStatus; currency: 'KRW' }> {
  if (videoIds.length === 0) return { rows: [], status: 'ok', currency: 'KRW' }
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET || !process.env.YOUTUBE_REFRESH_TOKEN) {
    return { rows: [], status: 'missing', currency: 'KRW' }
  }
  try {
    const accessToken = await refreshAccessToken()
    const ids = Array.from(new Set(videoIds)).slice(0, 50)
    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'estimatedRevenue',
      dimensions: 'day,video',
      filters: `video==${ids.join(',')}`,
      sort: 'day,video',
      currency: 'KRW',
    })
    const response = await fetch(`${YT_ANALYTICS_API}/reports?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (response.status === 401) return { rows: [], status: 'auth_error', currency: 'KRW' }
    if (response.status === 403) return { rows: [], status: 'monetary_scope_unavailable', currency: 'KRW' }
    if (!response.ok) return { rows: [], status: 'api_error', currency: 'KRW' }
    const data = await response.json() as {
      columnHeaders?: Array<{ name: string }>
      rows?: Array<Array<string | number>>
    }
    const indexes = new Map((data.columnHeaders || []).map((header, index) => [header.name, index]))
    if (['day', 'video', 'estimatedRevenue'].some(name => !indexes.has(name))) {
      return { rows: [], status: 'api_error', currency: 'KRW' }
    }
    return {
      rows: (data.rows || []).map(row => ({
        date: String(row[indexes.get('day')!] || ''),
        videoId: String(row[indexes.get('video')!] || ''),
        estimatedRevenue: Math.round(Number(row[indexes.get('estimatedRevenue')!] || 0)),
      })),
      status: 'ok',
      currency: 'KRW',
    }
  } catch (error) {
    return {
      rows: [],
      status: error instanceof YouTubeCredentialError ? 'auth_error' : 'api_error',
      currency: 'KRW',
    }
  }
}

export async function verifyYouTubeCredentials(): Promise<{
  ok: boolean
  analytics: boolean
  monetary: boolean
  reason?: 'missing' | 'invalid' | 'scope' | 'unavailable'
}> {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET || !process.env.YOUTUBE_REFRESH_TOKEN) {
    return { ok: false, analytics: false, monetary: false, reason: 'missing' }
  }
  try {
    const accessToken = await refreshAccessToken()
    const channelResponse = await fetch(`${YT_API}/channels?part=id&mine=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!channelResponse.ok) {
      return { ok: false, analytics: false, monetary: false, reason: channelResponse.status === 401 ? 'invalid' : 'scope' }
    }
    const channel = await channelResponse.json() as { items?: Array<{ id: string }> }
    if (!channel.items?.length) return { ok: false, analytics: false, monetary: false, reason: 'invalid' }

    const endDate = new Date().toISOString().slice(0, 10)
    const startDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    const base = new URLSearchParams({ ids: 'channel==MINE', startDate, endDate, metrics: 'views' })
    const analyticsResponse = await fetch(`${YT_ANALYTICS_API}/reports?${base}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const monetaryParams = new URLSearchParams({
      ids: 'channel==MINE', startDate, endDate, metrics: 'estimatedRevenue', currency: 'KRW',
    })
    const monetaryResponse = await fetch(`${YT_ANALYTICS_API}/reports?${monetaryParams}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const analytics = analyticsResponse.ok
    const monetary = monetaryResponse.ok
    return {
      ok: analytics,
      analytics,
      monetary,
      ...(!analytics ? { reason: analyticsResponse.status === 401 ? 'invalid' as const : 'scope' as const }
        : !monetary ? { reason: monetaryResponse.status === 401 ? 'invalid' as const : 'scope' as const }
          : {}),
    }
  } catch (error) {
    return {
      ok: false,
      analytics: false,
      monetary: false,
      reason: error instanceof YouTubeCredentialError ? 'invalid' : 'unavailable',
    }
  }
}

export interface VideoDetail {
  views: number
  likes: number
  privacy: 'public' | 'private' | 'unlisted' | 'unknown'
  thumbnail: string
  publishedAt: string | null
}

export interface YouTubeVideoAnalytics {
  views: number
  engagedViews: number
  estimatedMinutesWatched: number
  averageViewDuration: number
  averageViewPercentage: number
}

export interface YouTubeRetentionPoint {
  elapsedRatio: number
  audienceWatchRatio: number
  relativeRetention: number
}

export async function getYouTubeRetentionCurve(
  videoId: string, startDate: string, endDate: string
): Promise<YouTubeRetentionPoint[]> {
  const accessToken = await refreshAccessToken()
  const params = new URLSearchParams({
    ids: 'channel==MINE', startDate, endDate,
    metrics: 'audienceWatchRatio,relativeRetentionPerformance',
    dimensions: 'elapsedVideoTimeRatio', filters: `video==${videoId}`,
    sort: 'elapsedVideoTimeRatio',
  })
  const res = await fetch(`${YT_ANALYTICS_API}/reports?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`YouTube retention request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const data = await res.json() as { columnHeaders?: Array<{ name: string }>; rows?: number[][] }
  const indexes = new Map((data.columnHeaders || []).map((header, index) => [header.name, index]))
  const required = ['elapsedVideoTimeRatio', 'audienceWatchRatio', 'relativeRetentionPerformance']
  if (required.some(metric => !indexes.has(metric))) throw new Error('YouTube retention response columns are incomplete')
  return (data.rows || []).map(row => ({
    elapsedRatio: Number(row[indexes.get('elapsedVideoTimeRatio')!] || 0),
    audienceWatchRatio: Number(row[indexes.get('audienceWatchRatio')!] || 0),
    relativeRetention: Number(row[indexes.get('relativeRetentionPerformance')!] || 0),
  }))
}

export async function getYouTubeVideoAnalytics(
  videoIds: string[],
  startDate: string,
  endDate: string
): Promise<Record<string, YouTubeVideoAnalytics>> {
  if (videoIds.length === 0) return {}
  const accessToken = await refreshAccessToken()
  const result: Record<string, YouTubeVideoAnalytics> = {}

  const uniqueIds = Array.from(new Set(videoIds)).slice(0, 50)
  const params = new URLSearchParams({
    ids: 'channel==MINE', startDate, endDate,
    metrics: 'views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage',
    dimensions: 'video', filters: `video==${uniqueIds.join(',')}`,
  })
  const res = await fetch(`${YT_ANALYTICS_API}/reports?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const detail = await res.text()
    if (res.status === 401 || res.status === 403) throw new Error(`YouTube Analytics authorization failed (${res.status}): ${detail.slice(0, 300)}`)
    throw new Error(`YouTube Analytics request failed (${res.status}): ${detail.slice(0, 300)}`)
  }
  const data = await res.json() as { columnHeaders?: Array<{ name: string }>; rows?: Array<Array<string | number>> }
  const indexes = new Map((data.columnHeaders || []).map((header, index) => [header.name, index]))
  const required = ['video', 'views', 'engagedViews', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage']
  if (required.some(metric => !indexes.has(metric))) {
    throw new Error(`YouTube Analytics response is missing required columns: ${required.filter(metric => !indexes.has(metric)).join(', ')}`)
  }
  for (const row of data.rows || []) {
    const videoId = String(row[indexes.get('video')!] || '')
    if (!videoId) continue
    result[videoId] = {
      views: Number(row[indexes.get('views')!] || 0),
      engagedViews: Number(row[indexes.get('engagedViews')!] || 0),
      estimatedMinutesWatched: Number(row[indexes.get('estimatedMinutesWatched')!] || 0),
      averageViewDuration: Number(row[indexes.get('averageViewDuration')!] || 0),
      averageViewPercentage: Number(row[indexes.get('averageViewPercentage')!] || 0),
    }
  }

  return result
}

export async function getVideosStats(videoIds: string[]): Promise<Record<string, VideoDetail>> {
  if (videoIds.length === 0) return {}
  const accessToken = await refreshAccessToken()
  const idsParam = Array.from(new Set(videoIds)).slice(0, 50).join(',')
  const res = await fetch(
    `${YT_API}/videos?part=snippet,statistics,status&id=${encodeURIComponent(idsParam)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error(`YouTube video statistics request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const result: Record<string, VideoDetail> = {}
  for (const item of data.items ?? []) {
    result[item.id] = {
      views: parseInt(item.statistics?.viewCount ?? '0'),
      likes: parseInt(item.statistics?.likeCount ?? '0'),
      privacy: item.status?.privacyStatus ?? 'unknown',
      thumbnail: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
      publishedAt: item.snippet?.publishedAt ?? null,
    }
  }
  return result
}

export function buildShortsTags(productName: string, category: string): string[] {
  const base = ['쇼핑추천', '핫템', '쿠팡', '쿠팡추천', productName.slice(0, 20), '쇼츠', 'shorts']
  const catTags: Record<string, string[]> = {
    '뷰티': ['뷰티', '뷰티추천', '화장품', '스킨케어', '뷰티쇼츠', 'beauty'],
    '다이소': ['다이소', '다이소추천', '다이소하울', '생활용품', '다이소신상'],
    '스포츠': ['운동용품', '스포츠추천', '홈트', '운동하울', '헬스용품'],
    '유아': ['육아템', '유아용품', '아기용품', '육아추천', '육아쇼츠'],
    '패션': ['패션하울', '옷추천', '스타일링', '패션', '패션쇼츠'],
    '전자기기': ['전자제품', '테크리뷰', '가전', '디지털', '테크쇼츠'],
    '주방': ['주방용품', '쿠킹템', '요리도구', '주방추천'],
    '생활': ['생활용품', '생활추천', '집순이템', '홈인테리어'],
  }
  const extra = catTags[category] || ['쇼핑하울', '추천템', '득템']
  return [...base, ...extra].slice(0, 30)
}
