const YT_API = 'https://www.googleapis.com/youtube/v3'
const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos'
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

async function refreshAccessToken(): Promise<string> {
  const clientId = process.env.YOUTUBE_CLIENT_ID || ''
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || ''
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN || ''

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
  return data.access_token as string
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
      privacyStatus: opts.privacyStatus || 'public',
      selfDeclaredMadeForKids: opts.madeForKids || false,
      containsSyntheticMedia: true,
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

export function buildShortsDescription(
  script: string,
  affiliateUrl: string,
  hashtags: string[]
): string {
  return [
    script,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `🛒 구매링크: ${affiliateUrl}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
    hashtags.map(h => `#${h}`).join(' '),
    '',
    '* 이 영상은 AI(인공지능)로 생성된 콘텐츠를 포함합니다.',
    '* 이 영상은 쿠팡 파트너스 활동의 일환으로 수수료를 제공받을 수 있습니다.',
  ].join('\n')
}

export function buildShortsTags(productName: string, category: string): string[] {
  const base = ['쇼핑추천', '핫템', '쿠팡', productName.slice(0, 20)]
  const catTags: Record<string, string[]> = {
    '뷰티': ['뷰티', '뷰티추천', '화장품', '스킨케어'],
    '다이소': ['다이소', '다이소추천', '다이소하울', '생활용품'],
    '스포츠': ['운동용품', '스포츠추천', '홈트', '운동하울'],
    '유아': ['육아템', '유아용품', '아기용품', '육아추천'],
    '패션': ['패션하울', '옷추천', '스타일링', '패션'],
    '전자기기': ['전자제품', '테크리뷰', '가전', '디지털'],
  }
  const extra = catTags[category] || ['쇼핑하울', '추천템']
  return [...base, ...extra].slice(0, 15)
}
