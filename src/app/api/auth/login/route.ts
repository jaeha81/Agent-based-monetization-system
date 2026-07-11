import { NextRequest, NextResponse } from 'next/server'
import { adminSessionMaxAge, createAdminSession } from '@/lib/admin-auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { password } = await req.json() as { password: string }
  const expected = process.env.DASHBOARD_PASSWORD
  if (!expected || password !== expected) {
    return NextResponse.json({ ok: false, error: '비밀번호가 틀렸습니다.' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true, autoTriggered: false })
  res.cookies.set('admin_session', await createAdminSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: adminSessionMaxAge,
  })

  return res
}
