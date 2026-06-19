// Obsidian Brain System 동기화 유틸리티
// Claude Code 세션에서 Google Drive MCP를 통해 Vault에 기록
// Next.js 런타임에서는 직접 Drive 접근 불가 — /api/agent/obsidian이 리포트를 생성하면
// Claude Code가 이를 읽어 Drive MCP로 동기화한다

export interface EvolutionReport {
  date: string
  cycle: number
  healthBefore: number
  healthAfter: number
  problemsScanned: number
  problemsFixed: number
  problemsRemaining: number
  shotstackKeyValid: boolean
  log: string[]
  elapsedMs: number
}

export function buildObsidianEvolutionNote(r: EvolutionReport): string {
  const delta = r.healthAfter - r.healthBefore
  const deltaStr = delta >= 0 ? `+${delta}` : String(delta)

  return [
    '---',
    `type: evolution-log`,
    `project: shorts-dashboard`,
    `date: ${r.date}`,
    `cycle: ${r.cycle}`,
    `health_before: ${r.healthBefore}`,
    `health_after: ${r.healthAfter}`,
    `health_delta: ${deltaStr}`,
    `shotstack_key: ${r.shotstackKeyValid ? 'valid' : 'invalid'}`,
    '---',
    '',
    `# Shorts Dashboard 자가수리 사이클 #${r.cycle} — ${r.date}`,
    '',
    '## 결과 요약',
    '',
    `| 지표 | 값 |`,
    `|---|---|`,
    `| 건강도 변화 | ${r.healthBefore} → ${r.healthAfter} (${deltaStr}) |`,
    `| 스캔된 문제 | ${r.problemsScanned}건 |`,
    `| 수리 완료 | ${r.problemsFixed}건 |`,
    `| 잔여 문제 | ${r.problemsRemaining}건 |`,
    `| Shotstack 키 | ${r.shotstackKeyValid ? '✅ 유효' : '❌ 무효'} |`,
    `| 소요 시간 | ${r.elapsedMs}ms |`,
    '',
    '## 실행 로그',
    '',
    ...r.log.map(l => `- ${l}`),
  ].join('\n')
}

export function buildObsidianKnowledgeNote(
  title: string,
  body: string,
  tags: string[] = ['#project/shorts-dashboard']
): string {
  const tagLines = tags.map(t => `  - "${t}"`).join('\n')
  return [
    '---',
    `type: knowledge-note`,
    `project: shorts-dashboard`,
    `date: ${new Date().toISOString().slice(0, 10)}`,
    `tags:`,
    tagLines,
    '---',
    '',
    `# ${title}`,
    '',
    body,
  ].join('\n')
}

// Drive Folder IDs (Obsidian Vault — ObsidianVault root: 1qltI3QBuBJcryHkbfHX-opIeBi9f3Fzd)
export const OBSIDIAN_FOLDERS = {
  contextPacks: '1DeNNPTddz_wuIitNvpRztFwtAjuckKK2',  // 06_Context_Packs
  knowledge:    '10gSXu5BPbDLjc9JmPupFDxt9oMQ9A7RV',  // 03_Knowledge
  upgrade:      '18XMMzJnZARI5oOYeUfo6JaqJqCx1FUQk',  // 00_UPGRADE
  logs:         '1esXC2KrSdSL4p1SoPC2L8q42KG_MNIrf',  // 05_Logs
} as const
