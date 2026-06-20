import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { uploadYouTubeShorts, buildShortsDescription, buildShortsTags, postTopComment } from '@/lib/youtube'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/upload/video
// multipart/form-data: file (video/mp4), content_id (YouTube 콘텐츠 ID)
// Gemini 앱에서 생성한 Veo 영상을 받아 YouTube에 직접 업로드
export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'multipart/form-data 파싱 실패' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const contentId = Number(formData.get('content_id'))

  if (!file || !contentId) {
    return NextResponse.json({ error: 'file과 content_id 필요' }, { status: 400 })
  }

  if (!file.type.startsWith('video/')) {
    return NextResponse.json({ error: '동영상 파일만 업로드 가능합니다' }, { status: 400 })
  }

  const content = await queryOne<{
    id: number
    hook: string | null
    script: string | null
    product_name: string
    category: string
    coupang_url: string | null
  }>(
    `SELECT c.id, c.hook, c.script, p.name as product_name, p.category, p.coupang_url
     FROM content c JOIN products p ON c.product_id = p.id
     WHERE c.id = ? AND c.platform = 'YouTube'`,
    [contentId]
  )

  if (!content) {
    return NextResponse.json(
      { error: `content_id ${contentId} 없음 (YouTube 플랫폼만 지원)` },
      { status: 404 }
    )
  }

  try {
    const videoBuffer = Buffer.from(await file.arrayBuffer())

    const tags = buildShortsTags(content.product_name, content.category)
    const affiliateUrl = content.coupang_url || 'https://www.coupang.com'
    const description = buildShortsDescription(
      content.hook || content.script || '',
      affiliateUrl,
      tags
    )

    const result = await uploadYouTubeShorts(
      {
        title: (content.hook || content.product_name).slice(0, 100),
        description,
        tags,
        privacyStatus: 'private',
        madeForKids: false,
      },
      videoBuffer
    )

    await execute(
      `UPDATE content SET status = 'posted', posted_at = datetime('now'), video_url = ? WHERE id = ?`,
      [result.url, contentId]
    )
    await execute(
      `UPDATE scheduled_posts SET youtube_video_id = ?, status = 'published', published_at = datetime('now')
       WHERE content_id = ? AND platform = 'YouTube'`,
      [result.videoId, contentId]
    )

    await postTopComment(result.videoId, `🔥 최저가 링크 → ${affiliateUrl}`)

    console.log(`[VeoUpload] 업로드 완료: contentId=${contentId} videoId=${result.videoId}`)

    return NextResponse.json({ ok: true, videoId: result.videoId, url: result.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[VeoUpload] 실패:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
