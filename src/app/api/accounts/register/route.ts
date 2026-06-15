import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      account_type: string
      account_name: string
      bank_name?: string
      account_number?: string
      account_holder?: string
    }

    const { account_type, account_name, bank_name, account_number, account_holder } = body
    if (!account_type || !account_name) {
      return NextResponse.json({ error: '계좌 유형과 이름은 필수입니다.' }, { status: 400 })
    }

    const masked = account_number
      ? account_number.replace(/(\d{3})\d+(\d{4})/, '$1****$2')
      : null

    const db = getDb()
    const existing = db.prepare(
      `SELECT id FROM revenue_accounts WHERE account_type = ? AND account_name = ?`
    ).get(account_type, account_name)

    if (existing) {
      return NextResponse.json({ error: '이미 등록된 계좌입니다.' }, { status: 409 })
    }

    const r = db.prepare(
      `INSERT INTO revenue_accounts (account_type, account_name, bank_name, account_number_masked, account_holder)
       VALUES (?, ?, ?, ?, ?)`
    ).run(account_type, account_name, bank_name ?? null, masked, account_holder ?? null)

    return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid), masked })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function GET() {
  const db = getDb()
  const accounts = db.prepare(`SELECT * FROM revenue_accounts ORDER BY id`).all()
  return NextResponse.json({ ok: true, accounts })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = parseInt(searchParams.get('id') || '0')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  getDb().prepare(`DELETE FROM revenue_accounts WHERE id = ?`).run(id)
  return NextResponse.json({ ok: true })
}
