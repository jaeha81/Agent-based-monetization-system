import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { uploadYouTubeShorts, buildShortsDescription, buildShortsTags } from '@/lib/youtube'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const { contentId, videoUrl } = await req.json() as {
      contentId: number
      videoUrl?: string
    }

    const content = await queryOne<{
      id: number; hook: string; script: string
      product_name: string; category: string; coupang_url: string | null
    }>(
      `SELECT c.*, p.name as product_name, p.category, p.coupang_url
       FROM content c JOIN products p ON c.product_id = p.id
       WHERE c.id = ?`,
      [contentId]
    )

    if (!content) {
      return NextResponse.json({ error: '콘텐츠를 찾을 수 없습니다.' }, { status: 404 })
    }

    const affiliateUrl = content.coupang_url || `https://coupang.com`
    const tags = buildShortsTags(content.product_name, content.category)
    const description = buildShortsDescription(content.script || '', affiliateUrl, tags)

    if (!process.env.YOUTUBE_REFRESH_TOKEN) {
      await execute(
        `UPDATE content SET status = 'scheduled', posted_at = NULL WHERE id = ?`,
        [contentId]
      )
      return NextResponse.json({
        ok: true,
        mock: true,
        message: 'YouTube 인증 키 미설정. /setup에서 설정 후 재시도',
        title: `${content.hook?.slice(0, 80)}`,
        description,
        tags,
      })
    }

    let videoBuffer: Buffer
    if (videoUrl) {
      const res = await fetch(videoUrl)
      videoBuffer = Buffer.from(await res.arrayBuffer())
    } else {
      return NextResponse.json({ error: '영상 URL이 필요합니다.' }, { status: 400 })
    }

    const result = await uploadYouTubeShorts(
      {
        title: content.hook?.slice(0, 100) || content.product_name,
        description,
        tags,
        privacyStatus: 'public',
      },
      videoBuffer
    )

    await execute(
      `UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`,
      [contentId]
    )
    await execute(
      `UPDATE scheduled_posts SET status = 'published', youtube_video_id = ?, published_at = datetime('now')
       WHERE content_id = ? AND platform = 'YouTube'`,
      [result.videoId, contentId]
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
