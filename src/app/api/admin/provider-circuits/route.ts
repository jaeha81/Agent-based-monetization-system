import { NextRequest, NextResponse } from 'next/server'
import { execute, query } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'

export async function GET(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const circuits = await query<{ key: string; value: string; updated_at: string }>("SELECT key, value, updated_at FROM settings WHERE key LIKE 'circuit:%'")
  return NextResponse.json({ circuits })
}

export async function DELETE(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const provider = req.nextUrl.searchParams.get('provider')
  if (!provider || !/^[a-z0-9_-]+$/i.test(provider)) return NextResponse.json({ error: 'provider required' }, { status: 400 })
  await execute('DELETE FROM settings WHERE key = ?', [`circuit:${provider}`])
  return NextResponse.json({ ok: true, provider })
}
