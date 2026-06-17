import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const body = await req.json() as { hook?: string; script?: string; image_prompt?: string }
  const updates: string[] = []
  const args: (string | number)[] = []

  if (body.hook !== undefined) { updates.push('hook = ?'); args.push(body.hook) }
  if (body.script !== undefined) { updates.push('script = ?'); args.push(body.script) }
  if (body.image_prompt !== undefined) { updates.push('image_prompt = ?'); args.push(body.image_prompt) }
  if (updates.length === 0) return NextResponse.json({ error: 'no fields' }, { status: 400 })

  updates.push(`updated_at = datetime('now')`)
  args.push(id)

  await execute(`UPDATE content SET ${updates.join(', ')} WHERE id = ?`, args)
  const updated = await queryOne('SELECT * FROM content WHERE id = ?', [id])
  return NextResponse.json({ ok: true, content: updated })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  await execute(`DELETE FROM scheduled_posts WHERE content_id = ?`, [id])
  await execute(`DELETE FROM content WHERE id = ?`, [id])
  return NextResponse.json({ ok: true })
}
