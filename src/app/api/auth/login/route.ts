import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { password } = await req.json() as { password: string }
  const expected = process.env.DASHBOARD_PASSWORD || 'ljh911314'
  if (password !== expected) {
    return NextResponse.json({ ok: false, error: '비밀번호가 틀렸습니다.' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set('pwd_ok', '1', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return res
}
