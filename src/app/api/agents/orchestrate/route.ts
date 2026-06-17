import { NextResponse } from 'next/server'
import { sendDiscordWebhook } from '@/lib/discord'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST() {
  const webhookUrl = process.env.SHORTS_DISCORD_WEBHOOK

  // Discord Webhook 경로 (로컬 홈 PC 실행)
  if (webhookUrl) {
    await sendDiscordWebhook(
      webhookUrl,
      `[SHORTS_CMD] {"action":"run_pipeline","params":{}}`
    )
    return NextResponse.json({
      ok: true,
      mode: 'discord',
      message: '전체 사이클을 로컬 에이전트로 전달했습니다.',
    })
  }

  // fallback: 인라인 실행
  const { runFullCycle } = await import('@/lib/agents/orchestrator')
  try {
    const result = await runFullCycle()
    return NextResponse.json({ ok: true, mode: 'inline', ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
