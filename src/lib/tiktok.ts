const TT_API = 'https://open.tiktokapis.com/v2'

export interface TikTokPostOptions {
  videoUrl: string
  title: string
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY'
}

export interface TikTokPostResult {
  publishId: string
}

function getCredentials(): { token: string; openId: string } {
  const token = process.env.TIKTOK_ACCESS_TOKEN
  const openId = process.env.TIKTOK_OPEN_ID
  if (!token || !openId) throw new Error('TIKTOK_ACCESS_TOKEN, TIKTOK_OPEN_ID 미설정')
  return { token, openId }
}

export async function postTikTokVideo(opts: TikTokPostOptions): Promise<TikTokPostResult> {
  const { token, openId } = getCredentials()

  // Pull from URL upload
  const res = await fetch(`${TT_API}/post/publish/video/upload/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: opts.title.slice(0, 150),
        privacy_level: opts.privacyLevel || 'SELF_ONLY',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: opts.videoUrl,
      },
      open_id: openId,
    }),
  })

  if (!res.ok) throw new Error(`TikTok 업로드 실패: ${await res.text()}`)
  const data = await res.json() as { data: { publish_id: string }; error: { code: string; message: string } }
  if (data.error?.code !== 'ok') throw new Error(`TikTok 오류: ${data.error?.message}`)

  return { publishId: data.data.publish_id }
}

export async function getTikTokCreatorInfo(): Promise<{ displayName: string; followerCount: number }> {
  const { token, openId } = getCredentials()
  const res = await fetch(`${TT_API}/user/info/?open_id=${openId}&fields=display_name,follower_count`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return { displayName: '', followerCount: 0 }
  const data = await res.json() as { data: { user: { display_name: string; follower_count: number } } }
  return {
    displayName: data.data?.user?.display_name || '',
    followerCount: data.data?.user?.follower_count || 0,
  }
}
