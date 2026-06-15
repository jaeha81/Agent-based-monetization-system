import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function testGemini(): Promise<{ ok: boolean; model?: string; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY 없음' }
  try {
    const genAI = new GoogleGenerativeAI(apiKey.trim())
    const model = genAI.getGenerativeModel(
      { model: 'gemini-2.0-flash' },
      { apiVersion: 'v1' }
    )
    const result = await model.generateContent('ping')
    const text = result.response.text()
    return { ok: !!text, model: 'gemini-2.0-flash' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET() {
  const [runs, postsByStatus, productCount, contentByStatus, gemini] = await Promise.all([
    query('SELECT id, run_type, status, products_found, content_generated, posts_published, error, started_at, finished_at FROM automation_runs ORDER BY id DESC LIMIT 5'),
    query('SELECT status, COUNT(*) as c FROM scheduled_posts GROUP BY status'),
    query('SELECT COUNT(*) as c FROM products'),
    query('SELECT status, COUNT(*) as c FROM content GROUP BY status'),
    testGemini(),
  ])
  return NextResponse.json({
    automation_runs: runs,
    scheduled_posts: postsByStatus,
    products: productCount,
    content: contentByStatus,
    db_url: process.env.TURSO_DATABASE_URL ? 'turso' : 'local',
    mock_mode: process.env.USE_MOCK_DATA,
    gemini,
  })
}
