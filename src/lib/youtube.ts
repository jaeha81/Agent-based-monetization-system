const YT_API = 'https://www.googleapis.com/youtube/v3'
const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos'
const YT_ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

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
    const err = await res.text()
    throw new Error(`Token refresh 실패: ${err}`)
  }

  const data = await res.json()
  return stripBom(String(data.access_token || ''))
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
  script: string,
  affiliateUrl: string,
  hashtags: string[]
): string {
  return [
    '⚠️ 이 영상은 쿠팡 파트너스 활동으로 수수료를 받을 수 있습니다.',
    '⚠️ AI(인공지능)로 생성된 콘텐츠입니다.',
    '',
    script,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '🛒 구매링크 → 아래 고정 댓글 확인 (클릭 가능)',
    `구매링크: ${affiliateUrl}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
    hashtags.map(h => `#${h}`).join(' '),
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

export async function getYouTubeAnalyticsRevenue(
  startDate: string,
  endDate: string
): Promise<{ rows: YouTubeAnalyticsDay[]; totalRevenue: number; totalViews: number; hasMonetization: boolean }> {
  try {
    const accessToken = await refreshAccessToken()
    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,estimatedRevenue',
      dimensions: 'day',
      sort: 'day',
    })
    const res = await fetch(`${YT_ANALYTICS_API}/reports?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (res.status === 403) {
      // Missing yt-analytics-monetary.readonly scope or channel not monetized
      return { rows: [], totalRevenue: 0, totalViews: 0, hasMonetization: false }
    }
    if (!res.ok) return { rows: [], totalRevenue: 0, totalViews: 0, hasMonetization: false }

    const data = await res.json()
    const USD_TO_KRW = 1380
    const rows: YouTubeAnalyticsDay[] = (data.rows || []).map((row: [string, number, number, number]) => ({
      date: row[0],
      views: row[1] || 0,
      estimatedMinutesWatched: row[2] || 0,
      estimatedRevenue: Math.round((row[3] || 0) * USD_TO_KRW),
    }))
    const totalRevenue = rows.reduce((s, r) => s + r.estimatedRevenue, 0)
    const totalViews = rows.reduce((s, r) => s + r.views, 0)
    return { rows, totalRevenue, totalViews, hasMonetization: true }
  } catch {
    return { rows: [], totalRevenue: 0, totalViews: 0, hasMonetization: false }
  }
}

export interface VideoDetail {
  views: number
  likes: number
  privacy: 'public' | 'private' | 'unlisted' | 'unknown'
  thumbnail: string
  publishedAt: string | null
}

export async function getVideosStats(videoIds: string[]): Promise<Record<string, VideoDetail>> {
  if (videoIds.length === 0) return {}
  try {
    const accessToken = await refreshAccessToken()
    const idsParam = videoIds.slice(0, 50).join(',')
    const res = await fetch(
      `${YT_API}/videos?part=snippet,statistics,status&id=${encodeURIComponent(idsParam)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) return {}
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
  } catch {
    return {}
  }
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
