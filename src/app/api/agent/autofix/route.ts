import { NextResponse } from 'next/server'
import { runBrainScan, getActiveProblems, resolveAndFix } from '@/lib/agent-brain'
import { queryOne, execute, query } from '@/lib/db'
import { pollShotstackRender } from '@/lib/shotstack'
import { resumeVideoRenderJob } from '@/lib/workflow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 25

interface AutofixResponse {
  ok: boolean
  cycle: number
  scanned: number
  fixed: number
  remaining: number
  renderResumed: number
  shotstackKeyValid: boolean
  log: string[]
  elapsedMs: number
}

// Shotstack API 키 유효성 검증
async function validateShotstackKey(): Promise<boolean> {
  try {
    const key = process.env.SHOTSTACK_API_KEY?.replace(/^﻿/, '').trim()
    const stage = process.env.SHOTSTACK_STAGE === 'v1' ? 'v1' : 'stage'
    const authRes = await fetch(
      `https://api.shotstack.io/${stage}/render/health-check-probe`,
      { headers: { 'x-api-key': key || '' } }
    )
    return authRes.status !== 401 && authRes.status !== 403
  } catch {
    // 네트워크 오류는 키 무효로 간주하지 않음 (API 자체 문제일 수 있음)
    return true
  }
}

// POST /api/agent/autofix — 자율 자가수리 루프 1회 실행
export async function POST(): Promise<NextResponse<AutofixResponse>> {
  const startMs = Date.now()
  const log: string[] = []

  try {
    // ── 1. 이전 사이클 번호 조회 ───────────────────────────────────────────
    const lastEvo = await queryOne<{ c: number | null }>(
      `SELECT MAX(cycle) as c FROM evolution_log`
    )
    const prevCycle = lastEvo?.c ?? 0
    const thisCycle = prevCycle + 1
    log.push(`[사이클 #${thisCycle}] 자가수리 루프 시작`)

    // ── 2. 두뇌 스캔 (Before) ──────────────────────────────────────────────
    log.push('두뇌 스캔 실행 중...')
    const scanBefore = await runBrainScan()
    const scoreBefore = scanBefore.healthScore
    const scanned = scanBefore.problems.length
    log.push(`스캔 완료: 문제 ${scanned}건 감지 (건강도 ${scoreBefore})`)

    // ── 3. Shotstack 키 유효성 검증 ───────────────────────────────────────
    log.push('Shotstack API 키 검증 중...')
    const shotstackKeyValid = await validateShotstackKey()
    if (!shotstackKeyValid) {
      log.push('⚠️ SHOTSTACK_API_KEY 무효 — 렌더 재시도 중단')
    } else {
      log.push('Shotstack API 키 유효 확인')
    }

    // ── 4. 활성 문제 조회 및 수리 실행 ────────────────────────────────────
    const activeProblems = await getActiveProblems()
    let fixed = 0

    if (activeProblems.length === 0) {
      log.push('활성 문제 없음 — 수리 대상 없음')
    } else {
      log.push(`활성 문제 ${activeProblems.length}건 수리 시작...`)

      for (const problem of activeProblems) {
        if (!problem.id) continue

        // render_failure 인데 Shotstack 키가 무효면 건너뜀
        if (problem.type === 'render_failure' && !shotstackKeyValid) {
          log.push(`  ↳ [SKIP] ${problem.title} — Shotstack 키 무효로 렌더 재시도 중단`)
          continue
        }

        try {
          const result = await resolveAndFix(problem.id)
          if (result.ok) {
            fixed++
            log.push(`  ✓ [${problem.type}] ${problem.title} → ${result.action}: ${result.detail.slice(0, 100)}`)
          } else {
            log.push(`  ✕ [${problem.type}] ${problem.title} → 실패: ${result.detail.slice(0, 100)}`)
          }
        } catch (e) {
          log.push(`  ✕ [${problem.type}] ${problem.title} → 예외: ${e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80)}`)
        }
      }
    }

    log.push(`수리 완료: ${fixed}건 성공`)

    // ── 4b. Shotstack waiting 렌더 폴링 (sandbox webhook 불가 대응) ──────────
    let renderResumed = 0
    if (process.env.SHOTSTACK_API_KEY) {
      try {
        const waitingJobs = await query<{ id: number; render_id: string }>(
          `SELECT id, render_id FROM workflow_jobs WHERE status = 'waiting' AND render_id IS NOT NULL LIMIT 10`
        )
        if (waitingJobs.length > 0) {
          log.push(`렌더 폴링: waiting 잡 ${waitingJobs.length}건 확인 중...`)
          for (const job of waitingJobs) {
            try {
              const poll = await pollShotstackRender(job.render_id)
              if (poll.status === 'done' && poll.url) {
                await resumeVideoRenderJob(job.render_id, poll.url)
                renderResumed++
                log.push(`  ✓ render_id=${job.render_id} 완료 → youtube_upload 트리거`)
              } else if (poll.status === 'failed') {
                await execute(
                  `UPDATE workflow_jobs SET status = 'failed', error = 'Shotstack render failed', updated_at = datetime('now') WHERE id = ?`,
                  [job.id]
                )
                log.push(`  ✕ render_id=${job.render_id} 실패 처리`)
              } else {
                log.push(`  ⏳ render_id=${job.render_id} 진행 중 (${poll.status})`)
              }
            } catch (e) {
              log.push(`  ✕ render_id=${job.render_id} 폴링 오류: ${e instanceof Error ? e.message.slice(0, 60) : String(e).slice(0, 60)}`)
            }
          }
          log.push(`렌더 폴링 완료: ${renderResumed}건 유튜브 업로드 트리거됨`)
        } else {
          log.push('렌더 폴링: waiting 잡 없음')
        }
      } catch (e) {
        log.push(`렌더 폴링 오류: ${e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80)}`)
      }
    } else {
      log.push('렌더 폴링 건너뜀: SHOTSTACK_API_KEY 미설정')
    }

    // ── 5. 수리 후 재스캔 (After) ──────────────────────────────────────────
    log.push('사후 스캔 실행 중...')
    const scanAfter = await runBrainScan()
    const scoreAfter = scanAfter.healthScore
    const remaining = scanAfter.problems.length
    log.push(`사후 스캔 완료: 잔여 문제 ${remaining}건 (건강도 ${scoreAfter})`)

    // ── 6. evolution_log 기록 ─────────────────────────────────────────────
    const summary =
      `[자동수리 사이클 #${thisCycle}] ` +
      `스캔 ${scanned}건 감지, ${fixed}건 수리, ${remaining}건 잔여. ` +
      `건강도: ${scoreBefore} → ${scoreAfter}. ` +
      (shotstackKeyValid ? 'Shotstack 키 정상.' : 'Shotstack 키 무효 — 렌더 재시도 스킵.') +
      ` 처리: ${Date.now() - startMs}ms`

    try {
      await execute(
        `INSERT INTO evolution_log (cycle, insights, performance_delta, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [thisCycle, summary, scoreAfter - scoreBefore]
      )
      log.push(`evolution_log 기록 완료 (사이클 #${thisCycle})`)
    } catch (e) {
      log.push(`evolution_log 기록 실패: ${e instanceof Error ? e.message : String(e)}`)
    }

    const elapsedMs = Date.now() - startMs
    log.push(`총 소요시간: ${elapsedMs}ms`)

    return NextResponse.json({
      ok: true,
      cycle: thisCycle,
      scanned,
      fixed,
      remaining,
      renderResumed,
      shotstackKeyValid,
      log,
      elapsedMs,
    })
  } catch (err) {
    const elapsedMs = Date.now() - startMs
    const errMsg = err instanceof Error ? err.message : String(err)
    log.push(`치명적 오류: ${errMsg}`)

    return NextResponse.json(
      {
        ok: false,
        cycle: 0,
        scanned: 0,
        fixed: 0,
        remaining: 0,
        renderResumed: 0,
        shotstackKeyValid: true,
        log,
        elapsedMs,
      },
      { status: 500 }
    )
  }
}
