const FB_API = 'https://graph.facebook.com/v21.0'

export interface FacebookPostOptions {
  videoUrl: string
  description: string
  title: string
}

export interface FacebookPostResult {
  videoId: string
  url: string
}

function getCredentials(): { token: string; pageId: string } {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN
  const pageId = process.env.FACEBOOK_PAGE_ID
  if (!token || !pageId) throw new Error('FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID 미설정')
  return { token, pageId }
}

export async function postFacebookReel(opts: FacebookPostOptions): Promise<FacebookPostResult> {
  const { token, pageId } = getCredentials()

  const formData = new URLSearchParams({
    file_url: opts.videoUrl,
    description: opts.description.slice(0, 2200),
    title: opts.title.slice(0, 255),
    access_token: token,
  })

  const res = await fetch(`${FB_API}/${pageId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  })

  if (!res.ok) throw new Error(`Facebook 업로드 실패: ${await res.text()}`)
  const data = await res.json() as { id: string }
  return {
    videoId: data.id,
    url: `https://www.facebook.com/video/${data.id}`,
  }
}

export async function getFacebookPageStats(): Promise<{ followers: number; reach: number }> {
  const { token, pageId } = getCredentials()
  const res = await fetch(
    `${FB_API}/${pageId}?fields=followers_count&access_token=${token}`
  )
  if (!res.ok) return { followers: 0, reach: 0 }
  const data = await res.json() as { followers_count?: number }
  return { followers: data.followers_count || 0, reach: 0 }
}
