export interface LocalRenderRequest {
  contentId: number
  productName: string
  title: string
  hook: string
  script: string
  imageUrl?: string
  language: string
}

export async function submitLocalRender(input: LocalRenderRequest): Promise<{ id: string; videoUrl: string }> {
  const endpoint = process.env.LOCAL_RENDER_URL?.replace(/\/$/, '')
  if (!endpoint) throw new Error('LOCAL_RENDER_URL 미설정')
  const response = await fetch(`${endpoint}/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.LOCAL_RENDER_TOKEN ? { authorization: `Bearer ${process.env.LOCAL_RENDER_TOKEN}` } : {}) },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`로컬 렌더러 오류 (${response.status}): ${await response.text()}`)
  const data = await response.json() as { id?: string; videoUrl?: string }
  if (!data.id || !data.videoUrl) throw new Error('로컬 렌더러 응답에 id/videoUrl이 없습니다')
  return { id: data.id, videoUrl: data.videoUrl }
}
