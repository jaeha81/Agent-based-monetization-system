import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { submitShotstackScenicRender, submitShotstackRender } from '@/lib/shotstack'
import type { VideoScenario } from '@/lib/agents/scenario-agent'
import { generateProductImage, buildProductImagePrompt } from '@/lib/agents/image-agent'

export const runtime = 'nodejs'
export const maxDuration = 60

// 로컬 에이전트가 content_generation 완료 후 호출하는 엔드포인트
// 4씬 Shotstack 렌더를 비동기로 제출하고 즉시 반환.
export async function POST(req: NextRequest) {
  const auth = req.headers.get('Authorization') || ''
  const secret = process.env.UPLOAD_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let contentId: number
  try {
    const body = await req.json() as { content_id: number }
    contentId = Number(body.content_id)
    if (!contentId) throw new Error('content_id 없음')
  } catch {
    return NextResponse.json({ error: 'content_id 필요' }, { status: 400 })
  }

  const content = await queryOne<{
    id: number
    hook: string | null
    script: string | null
    image_prompt: string | null
    image_url: string | null
    language: string | null
    product_name: string
    category: string
    price: number | null
    coupang_url: string | null
  }>(
    `SELECT c.id, c.hook, c.script, c.image_prompt, c.image_url,
            c.language, p.name as product_name, p.category,
            p.price, p.coupang_url
     FROM content c JOIN products p ON c.product_id = p.id
     WHERE c.id = ? AND c.platform = 'YouTube'`,
    [contentId]
  )

  if (!content) {
    return NextResponse.json(
      { error: `content_id ${contentId} 없음 (YouTube 플랫폼 확인)` },
      { status: 404 }
    )
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shorts-dashboard-one.vercel.app'
    const callbackUrl = `${baseUrl}/api/webhook/shotstack?secret=${process.env.CRON_SECRET || ''}`
    const language = content.language || 'ko'
    const productName = content.product_name
    const category = content.category || '일반'
    const affiliateUrl = content.coupang_url || ''

    // 이미지 URL 준비 (저장된 것 우선, 없으면 생성)
    let imageUrl: string | null = content.image_url
    if (!imageUrl) {
      const prompt = content.image_prompt || buildProductImagePrompt(productName, category)
      imageUrl = await generateProductImage(prompt, category, productName)
    }

    // VideoScenario 구성
    const priceNum = content.price || 0
    const scenario: VideoScenario = {
      hook: (content.hook || `${productName} 지금 바로 확인!`).slice(0, 25),
      performancePoints: (() => {
        if (content.script) {
          const lines = content.script.split(/[\n.]+/).map(s => s.trim()).filter(s => s.length > 5 && s.length <= 35)
          if (lines.length >= 3) return [lines[0], lines[1], lines[2]]
        }
        return [`${productName} 핵심 기능`, '빠른 배송 · 쿠팡 보장', '최저가 보장']
      })(),
      originalPrice: priceNum > 0 ? `정가 ${priceNum.toLocaleString()}원` : '',
      salePrice: priceNum > 0 ? `지금 ${Math.floor(priceNum * 0.9).toLocaleString()}원` : '',
      priceText: priceNum > 0 ? `${Math.round((1 - 0.9) * 100)}% 할인 중` : '쿠팡 최저가 확인',
      cta: '지금 바로 구매하기',
      ttsScript: content.script?.slice(0, 250) || `${content.hook || productName}. 지금 쿠팡에서 최저가로 확인하세요.`,
      imagePrompt: content.image_prompt || buildProductImagePrompt(productName, category),
      scenes: [],
      youtubeDescription: `${content.hook || productName}\n\n✅ 지금 최저가 확인 👇\n${affiliateUrl}\n\n⏰ 오늘만 이 가격!\n\n※ 쿠팡 파트너스 활동으로 수수료를 받을 수 있습니다.`,
      pinnedComment: affiliateUrl ? `🛒 최저가 구매 링크: ${affiliateUrl}` : '',
    }

    let renderId: string
    try {
      renderId = await submitShotstackScenicRender(scenario, productName, imageUrl, language, callbackUrl, affiliateUrl)
    } catch (err) {
      // 4씬 실패 시 단순 렌더로 폴백
      console.warn('[upload/trigger] 4씬 렌더 실패, 단순 렌더 폴백:', err instanceof Error ? err.message : String(err))
      renderId = await submitShotstackRender(
        scenario.hook, productName, language, callbackUrl,
        scenario.ttsScript, affiliateUrl
      )
    }

    console.log(`[upload/trigger] Shotstack 렌더 제출: renderId=${renderId} contentId=${contentId}`)

    await execute(
      `INSERT INTO workflow_jobs
         (workflow_name, node_type, trigger_type, status, input_data, content_id, render_id, created_at)
       VALUES ('trigger_upload', 'video_render', 'webhook', 'waiting', ?, ?, ?, datetime('now'))`,
      [JSON.stringify({ contentId, language }), contentId, renderId]
    )
    await execute(
      `UPDATE content SET render_id = ?, render_status = 'rendering' WHERE id = ?`,
      [renderId, contentId]
    )

    return NextResponse.json({
      ok: true,
      status: 'pending',
      render_id: renderId,
      content_id: contentId,
      message: '4씬 렌더링 시작됨. Shotstack 완료 시 YouTube 업로드 자동 진행.',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[upload/trigger] 실패:`, msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
