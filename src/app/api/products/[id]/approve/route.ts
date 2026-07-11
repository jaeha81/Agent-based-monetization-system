import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PATCH /api/products/[id]/approve
// Body: { approved: true } or { approved: false }
// 수동 검증 단계: 자동 발굴된 상품을 승인/거절
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({})) as { approved?: boolean; action?: string }
  const approvedValue = body.approved !== undefined
    ? (body.approved ? 1 : 0)
    : (body.action === 'approve' ? 1 : 0)

  const product = await queryOne<{ id: number; name: string; category: string; viral_score: number }>(
    'SELECT id, name, category, viral_score FROM products WHERE id = ?',
    [id]
  )
  if (!product) {
    return NextResponse.json({ error: `Product ${id} not found` }, { status: 404 })
  }

  await execute('UPDATE products SET approved = ? WHERE id = ?', [approvedValue, id])

  console.log(`[Products] ${approvedValue ? '승인' : '거절'}: ${product.name} (id=${id})`)
  return NextResponse.json({
    ok: true,
    id,
    name: product.name,
    category: product.category,
    viral_score: product.viral_score,
    approved: approvedValue === 1,
  })
}

// GET /api/products/[id]/approve — 상품 승인 상태 조회
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 })
  }

  const product = await queryOne<{ id: number; name: string; category: string; viral_score: number; approved: number }>(
    'SELECT id, name, category, viral_score, approved FROM products WHERE id = ?',
    [id]
  )
  if (!product) {
    return NextResponse.json({ error: `Product ${id} not found` }, { status: 404 })
  }

  return NextResponse.json({
    id: product.id,
    name: product.name,
    category: product.category,
    viral_score: product.viral_score,
    approved: product.approved !== 0,
  })
}
