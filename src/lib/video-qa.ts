import { execute, queryOne } from '@/lib/db'
import { requireAffiliateUrl } from '@/lib/publishing-safety'
import { inspectMp4 } from '@/lib/mp4-inspector'

export interface QaResult {
  passed: boolean
  score: number
  checks: Array<{ name: string; passed: boolean; detail: string }>
}

export async function runAutomatedVideoQa(contentId: number, videoBuffer?: Buffer): Promise<QaResult> {
  let mediaMetadata: ReturnType<typeof inspectMp4> | null = null
  let mediaError = ''
  if (videoBuffer) {
    try {
      mediaMetadata = inspectMp4(videoBuffer)
      await execute(
        `UPDATE content SET video_width = ?, video_height = ?, video_duration_seconds = ? WHERE id = ?`,
        [mediaMetadata.width, mediaMetadata.height, mediaMetadata.durationSeconds, contentId]
      )
    } catch (error) {
      mediaError = error instanceof Error ? error.message : String(error)
    }
  }
  const content = await queryOne<{
    script: string | null; hook: string | null; coupang_url: string | null
    affiliate_disclosed: number | null; ai_disclosed: number | null; risk_level: string | null
    image_url: string | null; product_image_url: string | null; render_provider: string | null
    video_width: number | null; video_height: number | null; video_duration_seconds: number | null
  }>(`
    SELECT c.script, c.hook, c.affiliate_disclosed, c.ai_disclosed, c.risk_level, p.coupang_url,
           c.image_url, p.image_url AS product_image_url, c.render_provider,
           c.video_width, c.video_height, c.video_duration_seconds
    FROM content c JOIN products p ON p.id = c.product_id WHERE c.id = ?
  `, [contentId])
  if (!content) throw new Error(`QA 대상 콘텐츠 ${contentId}를 찾을 수 없습니다.`)

  let affiliatePassed = true
  let affiliateDetail = '유효한 상품 딥링크'
  try { requireAffiliateUrl(content.coupang_url) } catch (error) {
    affiliatePassed = false
    affiliateDetail = error instanceof Error ? error.message : String(error)
  }

  const scriptLength = (content.script || '').trim().length
  const productImageUrl = content.image_url || content.product_image_url
  const width = mediaMetadata?.width || 0
  const height = mediaMetadata?.height || 0
  const duration = mediaMetadata?.durationSeconds || 0
  const checks = [
    { name: 'product_image', passed: !!productImageUrl?.startsWith('https://'), detail: productImageUrl ? 'HTTPS product image' : 'missing product image' },
    { name: 'vertical_format', passed: width > 0 && height > 0 && Math.abs(width / height - 9 / 16) <= 0.01, detail: mediaError || `${width || '?'}x${height || '?'}` },
    { name: 'shorts_duration', passed: duration >= 8 && duration <= 60, detail: duration ? `${duration}s` : 'missing duration metadata' },
    { name: 'render_provider', passed: ['shotstack', 'veo', 'local', 'manual_verified'].includes(content.render_provider || ''), detail: content.render_provider || 'unknown provider' },
    { name: 'affiliate_link', passed: affiliatePassed, detail: affiliateDetail },
    { name: 'narration', passed: !!process.env.GOOGLE_TTS_API_KEY && scriptLength >= 40, detail: `TTS 설정=${!!process.env.GOOGLE_TTS_API_KEY}, 대본=${scriptLength}자` },
    { name: 'video_payload', passed: !!videoBuffer && videoBuffer.length >= 100_000 && !!mediaMetadata?.hasVideoTrack, detail: mediaError || (videoBuffer ? `${Math.round(videoBuffer.length / 1024)}KB` : '영상 바이트 확인 불가') },
    { name: 'disclosure', passed: content.affiliate_disclosed === 1 && content.ai_disclosed === 1, detail: `제휴=${content.affiliate_disclosed}, AI=${content.ai_disclosed}` },
    { name: 'risk', passed: content.risk_level !== 'high', detail: `위험도=${content.risk_level || '미지정'}` },
    { name: 'hook', passed: (content.hook || '').trim().length >= 5, detail: `훅=${(content.hook || '').trim().length}자` },
  ]
  const passedCount = checks.filter(check => check.passed).length
  const score = Math.round(passedCount / checks.length * 100)
  const passed = checks.every(check => check.passed)

  await execute(
    `UPDATE scheduled_posts SET qa_status = ?, qa_score = ?, qa_details = ?
     WHERE content_id = ? AND platform = 'YouTube'`,
    [passed ? 'passed' : 'failed', score, JSON.stringify(checks), contentId]
  )
  await execute(
    `UPDATE content SET compliance_status = ?, updated_at = datetime('now') WHERE id = ?`,
    [passed ? 'passed' : 'failed', contentId]
  )
  return { passed, score, checks }
}
