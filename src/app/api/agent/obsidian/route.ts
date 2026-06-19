import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { buildObsidianEvolutionNote, buildObsidianKnowledgeNote, OBSIDIAN_FOLDERS } from '@/lib/obsidian-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/agent/obsidian
// 현재 시스템 상태를 Obsidian 노트 포맷으로 반환
// Claude Code 세션에서 Drive MCP로 Vault에 기록할 때 사용
export async function GET() {
  const [lastEvo, activeProblems, recentJobs] = await Promise.all([
    queryOne<{ cycle: number; insights: string; performance_delta: number; created_at: string }>(
      `SELECT cycle, insights, performance_delta, created_at FROM evolution_log ORDER BY id DESC LIMIT 1`
    ),
    query<{ type: string; title: string; severity: string }>(
      `SELECT type, title, severity FROM brain_problems WHERE resolved=0 ORDER BY created_at DESC LIMIT 10`
    ),
    query<{ status: string; c: number }>(
      `SELECT status, COUNT(*) as c FROM workflow_jobs WHERE created_at > datetime('now','-24 hours') GROUP BY status`
    ),
  ])

  const today = new Date().toISOString().slice(0, 10)
  const cycle = lastEvo?.cycle ?? 0

  const evolutionNote = buildObsidianEvolutionNote({
    date: today,
    cycle,
    healthBefore: 0,
    healthAfter: lastEvo?.performance_delta ?? 0,
    problemsScanned: activeProblems.length,
    problemsFixed: 0,
    problemsRemaining: activeProblems.length,
    shotstackKeyValid: true,
    log: lastEvo ? [lastEvo.insights] : ['No autofix cycle run yet'],
    elapsedMs: 0,
  })

  const jobSummary = recentJobs.map(j => `${j.status}: ${j.c}건`).join(', ')

  const knowledgeNote = buildObsidianKnowledgeNote(
    `Shorts Dashboard 현황 — ${today}`,
    [
      '## 워크플로우 잡 (24h)',
      jobSummary || '데이터 없음',
      '',
      '## 활성 문제',
      activeProblems.length === 0
        ? '없음'
        : activeProblems.map(p => `- [${p.severity}] ${p.title}`).join('\n'),
      '',
      '## 자동화 사이클',
      lastEvo
        ? `마지막 사이클 #${lastEvo.cycle}: ${lastEvo.insights?.slice(0, 200)}`
        : '아직 자가수리 사이클 없음',
    ].join('\n'),
    ['#project/shorts-dashboard', '#area/monetization', '#status/active']
  )

  return NextResponse.json({
    today,
    activeProblems,
    recentJobs,
    lastEvoCycle: cycle,
    notes: {
      evolution: {
        content: evolutionNote,
        suggestedTitle: `${today}-shorts-dashboard-evolution-cycle-${cycle}.md`,
        folder: `03_Knowledge (Drive: ${OBSIDIAN_FOLDERS.knowledge})`,
      },
      knowledge: {
        content: knowledgeNote,
        suggestedTitle: `${today}-shorts-dashboard-status.md`,
        folder: `03_Knowledge (Drive: ${OBSIDIAN_FOLDERS.knowledge})`,
      },
    },
    driveFolders: OBSIDIAN_FOLDERS,
  })
}
