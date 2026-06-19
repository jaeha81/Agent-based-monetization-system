import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function testShotstack(): Promise<{ ok: boolean; stage?: string; error?: string; note?: string; lastRenderError?: string }> {
  const key = process.env.SHOTSTACK_API_KEY?.replace(/^﻿/, '').trim()
  if (!key) return { ok: false, error: 'SHOTSTACK_API_KEY 없음' }
  const stage = process.env.SHOTSTACK_STAGE === 'v1' ? 'v1' : 'stage'
  try {
    // 인증 확인: 존재하지 않는 ID로 GET — 키 유효 시 404, 오류 시 401/403
    const authRes = await fetch(`https://api.shotstack.io/${stage}/render/health-check-probe`, {
      headers: { 'x-api-key': key },
    })
    if (authRes.status === 401 || authRes.status === 403) {
      const body = await authRes.text()
      return { ok: false, stage, error: `인증 실패 HTTP ${authRes.status}: ${body.slice(0, 300)}` }
    }

    // 최근 실패한 렌더 에러 메시지 조회 (DB에 저장된 경우)
    let lastRenderError: string | undefined
    try {
      const { query } = await import('@/lib/db')
      const failedJobs = await query<{ error: string }>(
        `SELECT error FROM workflow_jobs WHERE node_type='video_render' AND status='failed' ORDER BY created_at DESC LIMIT 1`
      )
      if (failedJobs[0]?.error) lastRenderError = failedJobs[0].error
    } catch { /* db not available */ }

    return {
      ok: true,
      stage,
      note: authRes.status === 404 ? 'API 키 유효 (key valid)' : `HTTP ${authRes.status}`,
      ...(lastRenderError ? { lastRenderError: lastRenderError.slice(0, 500) } : {}),
    }
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
