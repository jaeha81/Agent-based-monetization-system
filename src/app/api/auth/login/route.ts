import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { password } = await req.json() as { password: string }
  const expected = process.env.DASHBOARD_PASSWORD
  if (!expected || password !== expected) {
    return NextResponse.json({ ok: false, error: '비밀번호가 틀렸습니다.' }, { status: 401 })
  }

  // 오늘 자동화가 실행됐는지 확인
  const todayRun = await queryOne<{ id: number }>(
    `SELECT id FROM automation_runs
     WHERE DATE(started_at) = DATE('now')
       AND status IN ('completed', 'running')
     LIMIT 1`
  ).catch(() => null)

  const res = NextResponse.json({ ok: true, autoTriggered: !todayRun })
  res.cookies.set('pwd_ok', '1', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })

  // 오늘 아직 실행 안 됐으면 백그라운드에서 자동화 트리거
  if (!todayRun) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shorts-dashboard-one.vercel.app'
    fetch(`${appUrl}/api/cron/daily`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
    }).catch(e => console.error('[Login] 자동화 트리거 실패:', e))
    console.log('[Login] 오늘 첫 접속 — 일일 자동화 트리거됨')
  }

  return res
}
