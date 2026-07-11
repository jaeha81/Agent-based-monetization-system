import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { requireAffiliateUrl } from '@/lib/publishing-safety'
import crypto from 'crypto'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const contentId = parseInt(searchParams.get('c') || '0')
  const productId = parseInt(searchParams.get('p') || '0')

  if (!contentId || !productId) {
    return NextResponse.json({ error: '잘못된 추적 링크입니다.' }, { status: 400 })
  }

  const product = await queryOne<{ coupang_url: string | null }>(
    `SELECT p.coupang_url FROM products p JOIN content c ON c.product_id = p.id
     WHERE p.id = ? AND c.id = ?`,
    [productId, contentId]
  )

  let affiliateUrl: string
  try {
    affiliateUrl = requireAffiliateUrl(product?.coupang_url)
  } catch {
    return NextResponse.json({ error: '유효한 제휴 상품 링크가 없습니다.' }, { status: 404 })
  }
  const ip = (req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim()
  const signingSecret = process.env.CLICK_HASH_SECRET
  const existingVisitor = req.cookies.get('click_visitor')?.value
  const visitor = existingVisitor && /^[a-f0-9]{32}$/.test(existingVisitor)
    ? existingVisitor
    : crypto.randomBytes(16).toString('hex')
  const ipHash = signingSecret
    ? crypto.createHmac('sha256', signingSecret).update(`${visitor}:${ip}`).digest('hex').slice(0, 32)
    : ''
  const ua = req.headers.get('user-agent') || ''

  const countable = !!signingSecret && ua.length > 3 && !/(bot|spider|crawler|preview|discordbot|facebookexternalhit)/i.test(ua)
  if (countable) {
    await execute(
      `INSERT INTO click_logs (content_id, product_id, affiliate_url, ip_hash, user_agent)
       SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
         SELECT 1 FROM click_logs WHERE content_id = ? AND ip_hash = ?
           AND clicked_at >= datetime('now', '-24 hours')
       )`,
      [contentId, productId, affiliateUrl, ipHash, ua.slice(0, 200), contentId, ipHash]
    )
  }

  const response = NextResponse.redirect(affiliateUrl)
  if (!existingVisitor) {
    response.cookies.set('click_visitor', visitor, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365,
    })
  }
  return response
}

export async function POST(req: NextRequest) {
  if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { contentId, productId } = await req.json() as {
      contentId: number
      productId: number
    }

    const relation = await queryOne<{ id: number }>(
      'SELECT id FROM content WHERE id = ? AND product_id = ?', [contentId, productId]
    )
    if (!relation) return NextResponse.json({ error: '콘텐츠와 상품이 일치하지 않습니다.' }, { status: 409 })

    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM click_logs WHERE product_id = ?`,
      [productId]
    )
    const clicks = row?.c ?? 0

    return NextResponse.json({ ok: true, validatedOnly: true, totalClicks: clicks })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
