import { NextRequest, NextResponse } from 'next/server'
import { refreshAccessToken } from '@/lib/youtube'

export const runtime = 'nodejs'
export const maxDuration = 120

const YT_API = 'https://www.googleapis.com/youtube/v3'

async function setVideoPrivate(videoId: string, accessToken: string): Promise<{ videoId: string; ok: boolean; error?: string }> {
  const res = await fetch(`${YT_API}/videos?part=status`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: videoId,
      status: { privacyStatus: 'private' },
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    return { videoId, ok: false, error: err.slice(0, 200) }
  }
  return { videoId, ok: true }
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { videoIds } = await req.json() as { videoIds: string[] }
  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return NextResponse.json({ error: 'videoIds 배열 필요' }, { status: 400 })
  }

  const accessToken = await refreshAccessToken()
  const results = await Promise.all(videoIds.map(id => setVideoPrivate(id, accessToken)))
  const succeeded = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)

  console.log(`[bulk-private] ${succeeded}/${videoIds.length} 비공개 처리 완료`)
  return NextResponse.json({ ok: true, succeeded, failed, results })
}
