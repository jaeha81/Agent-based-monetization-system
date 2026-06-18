const IG_API = 'https://graph.instagram.com/v21.0'

export interface InstagramPostOptions {
  videoUrl: string
  caption: string
  coverUrl?: string
}

export interface InstagramPostResult {
  mediaId: string
  url: string
}

async function getUser(): Promise<{ id: string; token: string }> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN
  const userId = process.env.INSTAGRAM_USER_ID
  if (!token || !userId) throw new Error('INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID 미설정')
  return { id: userId, token }
}

export async function postInstagramReel(opts: InstagramPostOptions): Promise<InstagramPostResult> {
  const { id, token } = await getUser()

  // 1단계: 미디어 컨테이너 생성
  const createRes = await fetch(`${IG_API}/${id}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: opts.videoUrl,
      caption: opts.caption,
      share_to_feed: true,
      access_token: token,
    }),
  })
  if (!createRes.ok) throw new Error(`Instagram 컨테이너 생성 실패: ${await createRes.text()}`)
  const { id: containerId } = await createRes.json() as { id: string }

  // 2단계: 처리 완료 대기 (최대 2분)
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const statusRes = await fetch(
      `${IG_API}/${containerId}?fields=status_code&access_token=${token}`
    )
    const { status_code } = await statusRes.json() as { status_code: string }
    if (status_code === 'FINISHED') break
    if (status_code === 'ERROR') throw new Error('Instagram 미디어 처리 실패')
  }

  // 3단계: 게시
  const publishRes = await fetch(`${IG_API}/${id}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  })
  if (!publishRes.ok) throw new Error(`Instagram 게시 실패: ${await publishRes.text()}`)
  const { id: mediaId } = await publishRes.json() as { id: string }

  return {
    mediaId,
    url: `https://www.instagram.com/reel/${mediaId}/`,
  }
}

export async function getInstagramStats(): Promise<{ followers: number; reach: number }> {
  const { id, token } = await getUser()
  const res = await fetch(
    `${IG_API}/${id}?fields=followers_count,reach&access_token=${token}`
  )
  if (!res.ok) return { followers: 0, reach: 0 }
  const data = await res.json() as { followers_count?: number; reach?: number }
  return {
    followers: data.followers_count || 0,
    reach: data.reach || 0,
  }
}
