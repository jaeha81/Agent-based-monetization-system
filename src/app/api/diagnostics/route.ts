import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function testShotstack(): Promise<{ ok: boolean; stage?: string; error?: string; renders?: number }> {
  const key = process.env.SHOTSTACK_API_KEY?.replace(/^﻿/, '').trim()
  if (!key) return { ok: false, error: 'SHOTSTACK_API_KEY 없음' }
  const stage = process.env.SHOTSTACK_STAGE === 'v1' ? 'v1' : 'stage'
  try {
    const res = await fetch(`https://api.shotstack.io/${stage}/renders?limit=5`, {
      headers: { 'x-api-key': key },
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, stage, error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }
    const data = await res.json()
    return { ok: true, stage, renders: data.response?.data?.length ?? 0 }
  } catch (err) {
    return { ok: false, stage, error: err instanceof Error ? err.message : String(err) }
  }
}

async function testGemini(): Promise<{ ok: boolean; model?: string; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY 없음' }
  try {
    const genAI = new GoogleGenerativeAI(apiKey.trim())
    const model = genAI.getGenerativeModel(
      { model: 'gemini-2.5-flash' },
      { apiVersion: 'v1beta' }
    )
    const result = await model.generateContent('ping')
    const text = result.response.text()
    return { ok: !!text, model: 'gemini-2.5-flash' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET() {
  const [runs, postsByStatus, productCount, contentByStatus, gemini, shotstack] = await Promise.all([
    query('SELECT id, run_type, status, products_found, content_generated, posts_published, error, started_at, finished_at FROM automation_runs ORDER BY id DESC LIMIT 5'),
    query('SELECT status, COUNT(*) as c FROM scheduled_posts GROUP BY status'),
    query('SELECT COUNT(*) as c FROM products'),
    query('SELECT status, COUNT(*) as c FROM content GROUP BY status'),
    testGemini(),
    testShotstack(),
  ])
  return NextResponse.json({
    automation_runs: runs,
    scheduled_posts: postsByStatus,
    products: productCount,
    content: contentByStatus,
    db_url: process.env.TURSO_DATABASE_URL ? 'turso' : 'local',
    mock_mode: process.env.USE_MOCK_DATA,
    gemini,
    shotstack,
  })
}
