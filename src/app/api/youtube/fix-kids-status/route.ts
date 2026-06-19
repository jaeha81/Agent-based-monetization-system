import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { patchVideoNotForKids } from '@/lib/youtube'

export async function POST() {
  try {
    const rows = await query<{ youtube_video_id: string }>(`
      SELECT DISTINCT youtube_video_id
      FROM scheduled_posts
      WHERE youtube_video_id IS NOT NULL
        AND youtube_video_id != ''
    `)

    const videoIds = rows.map(r => r.youtube_video_id)
    if (videoIds.length === 0) {
      return NextResponse.json({ updated: 0, message: '업데이트할 영상 없음' })
    }

    const results: { videoId: string; ok: boolean; error?: string }[] = []
    for (const videoId of videoIds) {
      try {
        await patchVideoNotForKids(videoId)
        results.push({ videoId, ok: true })
      } catch (e) {
        results.push({ videoId, ok: false, error: String(e) })
      }
    }

    const succeeded = results.filter(r => r.ok).length
    return NextResponse.json({
      total: videoIds.length,
      updated: succeeded,
      failed: videoIds.length - succeeded,
      results,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
