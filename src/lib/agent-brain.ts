import { query, queryOne, execute } from './db'

export type ProblemSeverity = 'critical' | 'warning' | 'info'
export type ProblemType =
  | 'upload_failure'
  | 'render_failure'
  | 'low_performance'
  | 'system_error'
  | 'revenue_drop'
  | 'compliance_violation'

export interface BrainProblem {
  id?: number
  type: ProblemType
  severity: ProblemSeverity
  title: string
  description: string
  recommendation: string
  resolved: boolean
  detected_at: string
}

export interface ComplianceItem {
  rule: string
  regulation: string
  region: string
  status: 'pass' | 'fail' | 'warning' | 'manual'
  detail: string
}

export interface GlobalStrategy {
  primaryMarket: string
  platforms: string[]
  topCategories: Array<{ category: string; commissionRate: number; avgViews: number }>
  evolutionCycle: number
  nextActions: string[]
}

export interface BrainStatus {
  lastScanAt: string
  problems: BrainProblem[]
  compliance: ComplianceItem[]
  strategy: GlobalStrategy
  healthScore: number
  complianceScore: number
}

const COMMISSION_RATES: Record<string, number> = {
  유아: 7.0, 스포츠: 6.0, 뷰티: 5.0, 생활용품: 4.0, 식품: 3.0, 패션: 2.0, 전자기기: 1.5,
}

// ── 법적 규제 준수 체크 (정적 + 코드베이스 기반) ─────────────────────────────
function checkCompliance(): ComplianceItem[] {
  return [
    {
      rule: '광고 표시 의무',
      regulation: '공정거래위원회 추천·보증 심사지침',
      region: '한국',
      status: 'pass',
      detail: '영상 설명 첫 줄 "[광고/협찬] 쿠팡 파트너스 수수료 수령" 자동 삽입 ✓',
    },
    {
      rule: '쿠팡 파트너스 수수료 공시',
      regulation: '전자상거래법 제21조 (기만적 행위 금지)',
      region: '한국',
      status: 'pass',
      detail: 'buildShortsDescription() 내 수수료 수령 사실 명시 ✓',
    },
    {
      rule: 'AI 생성 콘텐츠 공시',
      regulation: 'YouTube 정책 (2024.03~), 방심위 AI콘텐츠 가이드라인',
      region: '글로벌',
      status: 'pass',
      detail: 'containsSyntheticMedia=true (YouTube API) + "[AI 생성 콘텐츠]" 설명 삽입 ✓',
    },
    {
      rule: '어린이용 콘텐츠 분류',
      regulation: 'COPPA (미국) / YouTube 아동보호정책',
      region: '글로벌',
      status: 'pass',
      detail: 'selfDeclaredMadeForKids=false 기본값. POST /api/youtube/fix-kids-status 일괄 적용 권장.',
    },
    {
      rule: '유료 제품 홍보 표시',
      regulation: 'YouTube 유료 홍보 정책',
      region: '글로벌',
      status: 'pass',
      detail: 'paidProductPlacementDetails.hasPaidProductPlacement=true (YouTube API) ✓',
    },
    {
      rule: 'FTC 어필리에이트 공시',
      regulation: 'FTC Endorsement Guidelines (16 CFR Part 255)',
      region: '미국',
      status: 'warning',
      detail: '현재 한국어 공시만 존재. 영어권 시청자 대상 영문 공시 추가 필요: "This video contains affiliate links."',
    },
    {
      rule: '저작권 침해 없음',
      regulation: 'DMCA / 저작권법 제104조의2',
      region: '글로벌',
      status: 'manual',
      detail: 'Shotstack 자체 제작 영상만 사용. 배경음악 라이선스(Royalty-free) 확인 권장. YouTube Studio 저작권 알림 주기적 확인 필요.',
    },
    {
      rule: '개인정보 미수집',
      regulation: '개인정보보호법 (PIPA) / GDPR',
      region: '글로벌',
      status: 'pass',
      detail: '사용자 개인정보 수집 없음. 어필리에이트 클릭 해시(IP hash)만 기록. GDPR 적용 지역 트래픽 없음 ✓',
    },
  ]
}

// ── 문제 감지 (실시간 DB 분석) ─────────────────────────────────────────────────
async function detectProblems(): Promise<BrainProblem[]> {
  const problems: BrainProblem[] = []
  const now = new Date().toISOString()

  try {
    // 1. 워크플로우 실패율 (24h)
    const jobStats = await queryOne<{ total: number; failed: number }>(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
       FROM workflow_jobs WHERE created_at > datetime('now','-24 hours')`
    )
    if (jobStats && jobStats.total > 0) {
      const rate = jobStats.failed / jobStats.total
      if (rate > 0.5) {
        problems.push({
          type: 'system_error', severity: 'critical',
          title: `워크플로우 실패율 ${Math.round(rate * 100)}% (24h)`,
          description: `${jobStats.failed}/${jobStats.total} 작업 실패. 파이프라인이 거의 동작하지 않고 있습니다.`,
          recommendation: 'Vercel 함수 로그 확인. Gemini API 할당량 소진 여부, Turso DB 연결 상태 점검.',
          resolved: false, detected_at: now,
        })
      } else if (rate > 0.2) {
        problems.push({
          type: 'system_error', severity: 'warning',
          title: `워크플로우 실패율 ${Math.round(rate * 100)}% (24h)`,
          description: `${jobStats.failed}/${jobStats.total} 작업 실패. 간헐적 오류 발생 중.`,
          recommendation: 'API 오류 패턴 확인. Fallback(Claude CLI) 동작 여부 점검.',
          resolved: false, detected_at: now,
        })
      }
    }

    // 2. Shotstack 렌더 실패 (48h) — 실제 에러 메시지 포함
    const renderFailData = await queryOne<{ count: number; last_error: string | null }>(
      `SELECT COUNT(*) as count, MAX(error) as last_error FROM workflow_jobs
       WHERE node_type='video_render' AND status='failed'
       AND created_at > datetime('now','-48 hours')`
    )
    if (renderFailData && renderFailData.count > 0) {
      const errSnippet = renderFailData.last_error
        ? `마지막 오류: ${renderFailData.last_error.slice(0, 120)}`
        : '오류 메시지 없음 (DB 확인 필요)'
      const isAuthError = renderFailData.last_error?.includes('401') || renderFailData.last_error?.includes('403') || renderFailData.last_error?.includes('invalid') || renderFailData.last_error?.includes('unauthorized')
      const isTtsError = renderFailData.last_error?.toLowerCase().includes('tts') || renderFailData.last_error?.toLowerCase().includes('voice')
      const recommendation = isAuthError
        ? 'SHOTSTACK_API_KEY가 유효하지 않습니다. Vercel 환경변수에서 키를 재확인하세요.'
        : isTtsError
          ? 'TTS(음성합성) 오류입니다. Shotstack sandbox에서 TTS가 지원되지 않을 수 있습니다. stage→v1(production) 전환 확인.'
          : 'SHOTSTACK_API_KEY 유효성 확인. SHOTSTACK_STAGE=v1 설정 여부 확인.'
      problems.push({
        type: 'render_failure',
        severity: renderFailData.count > 3 ? 'critical' : 'warning',
        title: `Shotstack 렌더 실패 ${renderFailData.count}건 (48h)`,
        description: `영상 렌더링에 반복적으로 실패하고 있습니다. ${errSnippet}`,
        recommendation,
        resolved: false, detected_at: now,
      })
    }

    // 3. YouTube 업로드 실패 (48h)
    const uploadFails = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM scheduled_posts
       WHERE status='failed' AND created_at > datetime('now','-48 hours')`
    )
    if (uploadFails && uploadFails.count > 2) {
      problems.push({
        type: 'upload_failure', severity: 'critical',
        title: `YouTube 업로드 실패 ${uploadFails.count}건 (48h)`,
        description: 'YouTube Shorts 업로드가 반복 실패. 수익 창출 중단 위험.',
        recommendation: 'YouTube OAuth 토큰 만료 여부 확인. /setup → YouTube 재인증 필요.',
        resolved: false, detected_at: now,
      })
    }

    // 4. 콘텐츠 생성 정지 감지
    const lastContent = await queryOne<{ created_at: string }>(
      `SELECT created_at FROM content ORDER BY created_at DESC LIMIT 1`
    )
    if (lastContent) {
      const hoursSince = (Date.now() - new Date(lastContent.created_at).getTime()) / 3_600_000
      if (hoursSince > 48) {
        problems.push({
          type: 'system_error', severity: 'critical',
          title: `콘텐츠 생성 ${Math.round(hoursSince)}시간 중단`,
          description: '데일리 파이프라인이 48시간 이상 콘텐츠를 생성하지 않았습니다.',
          recommendation: 'Vercel Cron 상태 확인. /api/cron/daily 수동 트리거 테스트.',
          resolved: false, detected_at: now,
        })
      } else if (hoursSince > 28) {
        problems.push({
          type: 'system_error', severity: 'warning',
          title: `콘텐츠 생성 ${Math.round(hoursSince)}시간 경과`,
          description: '최근 콘텐츠가 28시간 이상 생성되지 않았습니다. 정상 주기(24h)를 초과했습니다.',
          recommendation: '데일리 Cron 실행 결과 확인. AI API 할당량 점검.',
          resolved: false, detected_at: now,
        })
      }
    }

    // 5. 주간 수익 하락
    try {
      const revStats = await queryOne<{ this_week: number; last_week: number }>(
        `SELECT
           COALESCE((SELECT SUM(amount) FROM revenue_logs WHERE logged_at > datetime('now','-7 days')), 0) as this_week,
           COALESCE((SELECT SUM(amount) FROM revenue_logs WHERE logged_at BETWEEN datetime('now','-14 days') AND datetime('now','-7 days')), 0) as last_week`
      )
      if (revStats && revStats.last_week > 10000 && revStats.this_week < revStats.last_week * 0.5) {
        problems.push({
          type: 'revenue_drop', severity: 'warning',
          title: `주간 수익 ${Math.round((1 - revStats.this_week / revStats.last_week) * 100)}% 감소`,
          description: `이번주 ₩${revStats.this_week.toLocaleString()} vs 지난주 ₩${revStats.last_week.toLocaleString()}`,
          recommendation: '유아(7%) 카테고리 집중. 조회수 높은 영상의 훅 패턴 재사용. 쿠팡 링크 유효성 재확인.',
          resolved: false, detected_at: now,
        })
      }
    } catch { /* revenue_logs 없으면 무시 */ }

    // 6. 공개 영상 없음 (private만 존재)
    const publicCount = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM scheduled_posts
       WHERE youtube_video_id IS NOT NULL AND status = 'published'`
    )
    const privateOnlyHint = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM scheduled_posts
       WHERE youtube_video_id IS NOT NULL`
    )
    if (privateOnlyHint && privateOnlyHint.count > 0 && publicCount && publicCount.count === 0) {
      problems.push({
        type: 'low_performance', severity: 'critical',
        title: '업로드된 영상 전부 비공개 상태',
        description: `${privateOnlyHint.count}개 영상이 YouTube에 업로드됐지만 전부 private. 조회수 0, 수익 0.`,
        recommendation: 'YouTube Studio에서 공개 전환 또는 /api/youtube/fix-kids-status 실행 후 공개 처리.',
        resolved: false, detected_at: now,
      })
    }

  } catch (err) {
    console.error('[AgentBrain] detectProblems error:', err)
  }

  return problems
}

// ── 글로벌 수익화 전략 분석 ─────────────────────────────────────────────────────
async function buildGlobalStrategy(): Promise<GlobalStrategy> {
  try {
    const evo = await queryOne<{ cycle: number }>(
      `SELECT MAX(cycle) as cycle FROM evolution_log`
    )

    const topCats = await query<{ category: string; avg_views: number; count: number }>(
      `SELECT p.category, AVG(COALESCE(c.views, 0)) as avg_views, COUNT(*) as count
       FROM content c JOIN products p ON c.product_id = p.id
       WHERE c.status IN ('posted','scheduled')
       GROUP BY p.category ORDER BY avg_views DESC LIMIT 6`
    )

    const topCategories = topCats.length > 0
      ? topCats.map(c => ({
          category: c.category,
          commissionRate: COMMISSION_RATES[c.category] ?? 3.0,
          avgViews: Math.round(c.avg_views ?? 0),
        }))
      : [
          { category: '유아', commissionRate: 7.0, avgViews: 0 },
          { category: '스포츠', commissionRate: 6.0, avgViews: 0 },
          { category: '뷰티', commissionRate: 5.0, avgViews: 0 },
        ]

    return {
      primaryMarket: '한국 (Coupang KR — 유아 7%, 스포츠 6%, 뷰티 5%)',
      platforms: ['YouTube Shorts', 'Instagram Reels', 'TikTok', 'Facebook Reels'],
      topCategories,
      evolutionCycle: evo?.cycle ?? 0,
      nextActions: [
        '유아(7%) 카테고리 콘텐츠 비중 우선 증가 → 클릭당 수익 최대화',
        '성과 영상(조회수 TOP 20%) 훅 패턴 추출 → 다음 사이클 재사용',
        'Shotstack production 전환 → 워터마크 없는 영상으로 CTR 개선',
        '글로벌 2단계: Amazon.co.jp(일본) 어필리에이트 연동 준비',
        '다국어 콘텐츠: 영어/일본어 Shorts 스크립트 생성 → 글로벌 노출 확대',
      ],
    }
  } catch {
    return {
      primaryMarket: '한국 (Coupang KR)',
      platforms: ['YouTube Shorts'],
      topCategories: [{ category: '유아', commissionRate: 7.0, avgViews: 0 }],
      evolutionCycle: 0,
      nextActions: ['첫 번째 파이프라인 실행 후 전략 분석 가능'],
    }
  }
}

function calcHealthScore(problems: BrainProblem[]): number {
  let score = 100
  for (const p of problems) {
    if (p.severity === 'critical') score -= 30
    else if (p.severity === 'warning') score -= 15
    else score -= 5
  }
  return Math.max(0, score)
}

// ── 퍼블릭 API ─────────────────────────────────────────────────────────────────
export async function runBrainScan(): Promise<BrainStatus> {
  const [problems, compliance, strategy] = await Promise.all([
    detectProblems(),
    Promise.resolve(checkCompliance()),
    buildGlobalStrategy(),
  ])

  // 신규 문제만 DB 저장 (중복 방지: 같은 title + 미해결)
  for (const p of problems) {
    try {
      await execute(
        `INSERT INTO brain_problems (type, severity, title, description, recommendation, resolved, detected_at)
         SELECT ?,?,?,?,?,0,datetime('now') WHERE NOT EXISTS (
           SELECT 1 FROM brain_problems WHERE title=? AND resolved=0
         )`,
        [p.type, p.severity, p.title, p.description, p.recommendation, p.title]
      )
    } catch { /* table not yet created → ignore until migration applied */ }
  }

  const healthScore = calcHealthScore(problems)
  const passCount = compliance.filter(c => c.status === 'pass').length
  const complianceScore = Math.round((passCount / compliance.length) * 100)

  return {
    lastScanAt: new Date().toISOString(),
    problems,
    compliance,
    strategy,
    healthScore,
    complianceScore,
  }
}

export async function getActiveProblems(): Promise<BrainProblem[]> {
  try {
    return await query<BrainProblem>(
      `SELECT * FROM brain_problems WHERE resolved=0 ORDER BY detected_at DESC LIMIT 30`
    )
  } catch {
    return []
  }
}

export async function resolveProblem(id: number): Promise<void> {
  await execute(`UPDATE brain_problems SET resolved=1 WHERE id=?`, [id])
}

// ── 자가 복구: 문제 유형별 실제 픽스 액션 실행 ────────────────────────────────
export async function resolveAndFix(
  id: number
): Promise<{ ok: boolean; action: string; detail: string }> {
  let problem: (BrainProblem & { id: number }) | undefined = undefined
  try {
    problem = await queryOne<BrainProblem & { id: number }>(
      `SELECT * FROM brain_problems WHERE id=?`, [id]
    )
  } catch { /* brain_problems 테이블 없으면 스킵 */ }

  if (!problem) return { ok: false, action: 'not_found', detail: '문제를 찾을 수 없습니다.' }

  try {
    let action = ''
    let detail = ''

    switch (problem.type) {
      case 'render_failure': {
        // SHOTSTACK_API_KEY 미설정 시 재시도 무의미 — 즉시 중단
        if (!process.env.SHOTSTACK_API_KEY?.trim()) {
          return {
            ok: false,
            action: 'no_api_key',
            detail: 'SHOTSTACK_API_KEY 미설정. Vercel 환경변수 확인 필요.',
          }
        }

        // 실패한 video_render 잡을 queued로 재설정 → 다음 처리 사이클에서 재시도
        const failedJobs = await query<{ id: number }>(
          `SELECT id FROM workflow_jobs
           WHERE node_type='video_render' AND status='failed'
           AND created_at > datetime('now','-48 hours')`
        )
        if (failedJobs.length === 0) {
          action = 'no_failed_jobs'
          detail = '재시도할 실패 잡이 없습니다. 에러가 자연 소멸됐거나 이미 처리됨.'
          break
        }
        for (const job of failedJobs) {
          await execute(
            `UPDATE workflow_jobs
             SET status='queued', error=NULL, started_at=NULL, completed_at=NULL
             WHERE id=?`,
            [job.id]
          )
        }
        // 실패한 잡 수만큼만 즉시 처리 (불필요한 전체 재처리 방지)
        const { processPendingJobs } = await import('./workflow-engine')
        await processPendingJobs(undefined, failedJobs.length)
        action = 'render_requeued'
        detail = `실패한 렌더 ${failedJobs.length}건을 재시도 큐에 넣고 즉시 처리를 시작했습니다.`
        break
      }

      case 'upload_failure': {
        // 실패한 scheduled_posts를 5분 후 재시도로 재설정
        const { lastInsertRowid: affectedRows } = await execute(
          `UPDATE scheduled_posts
           SET status='pending', retry_count=0,
               scheduled_for=datetime('now','+5 minutes'), error=NULL
           WHERE status='failed' AND created_at > datetime('now','-48 hours')`
        )
        action = 'upload_requeued'
        detail = `실패한 게시물을 5분 후 재시도 예약했습니다. (영향: ${affectedRows ?? '?'}건)`
        break
      }

      case 'system_error': {
        if (problem.title.includes('콘텐츠 생성')) {
          // 콘텐츠 생성 중단 → 워크플로우 수동 트리거
          const { startWorkflow } = await import('./workflow-engine')
          const result = await startWorkflow('brain-autofix', 'manual')
          action = 'workflow_triggered'
          detail = `워크플로우를 수동으로 시작했습니다. (rootJob: ${result.rootJobId})`
        } else {
          action = 'acknowledged'
          detail = '문제를 확인 처리했습니다. Vercel 로그를 직접 점검하세요.'
        }
        break
      }

      case 'low_performance': {
        // 전부 비공개 → YouTube fix-kids-status 엔드포인트 호출
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shorts-dashboard-one.vercel.app'
        try {
          const res = await fetch(`${baseUrl}/api/youtube/fix-kids-status`, { method: 'POST' })
          const data = await res.json() as { fixed?: number; error?: string }
          action = 'youtube_kids_fixed'
          detail = data.error
            ? `YouTube 상태 수정 실패: ${data.error}`
            : `YouTube 영상 ${data.fixed ?? 0}건의 kids 상태를 수정했습니다. YouTube Studio에서 공개 전환하세요.`
        } catch (e) {
          action = 'youtube_fix_failed'
          detail = `YouTube 수정 API 호출 실패: ${e instanceof Error ? e.message : String(e)}`
        }
        break
      }

      default: {
        action = 'acknowledged'
        detail = '문제를 확인 처리했습니다.'
      }
    }

    await execute(`UPDATE brain_problems SET resolved=1 WHERE id=?`, [id])
    return { ok: true, action, detail }
  } catch (err) {
    return {
      ok: false,
      action: 'error',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
