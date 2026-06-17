import { NextRequest, NextResponse } from 'next/server'
import { sendDiscordWebhook } from '@/lib/discord'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    keyword?: string
    market?: string
    action?: string
  }

  const webhookUrl = process.env.SHORTS_DISCORD_WEBHOOK
  const action = body.action || 'run_pipeline'

  // Discord Webhook 경로 (로컬 홈 PC 실행)
  if (webhookUrl) {
    const command = JSON.stringify({ action, params: { keyword: body.keyword, market: body.market || 'KR' } })
    await sendDiscordWebhook(webhookUrl, `[SHORTS_CMD] ${command}`)
    console.log(`[API] shorts 명령 Discord 전송: ${action}`)
    return NextResponse.json({
      ok: true,
      mode: 'discord',
      action,
      message: `${action} 명령을 로컬 에이전트로 전달했습니다. Discord #jh-shorts 채널에서 진행 상황을 확인하세요.`,
    })
  }

  // fallback: 인라인 실행 (SHORTS_DISCORD_WEBHOOK 미설정 시)
  const { startWorkflow } = await import('@/lib/workflow-engine')
  try {
    const result = await startWorkflow('daily_pipeline', 'manual', {
      keyword: body.keyword,
      market: body.market || 'KR',
      language: 'ko',
    })
    return NextResponse.json({ ok: true, mode: 'inline', ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
