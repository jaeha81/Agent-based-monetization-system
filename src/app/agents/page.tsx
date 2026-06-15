'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Play, RefreshCw, TrendingUp, FileText, Upload,
  DollarSign, Brain, Cpu, CheckCircle, XCircle,
  Clock, Zap, Activity
} from 'lucide-react'

interface AgentState {
  agent_name: string
  status: string
  current_task: string | null
  last_result: string | null
  total_runs: number
  success_runs: number
  revenue_contributed: number
  last_run_at: string | null
  next_run_at: string | null
}

interface AgentTask {
  id: number
  agent_name: string
  task_type: string
  status: string
  result: string | null
  created_at: string
  completed_at: string | null
}

interface EvolutionLog {
  id: number
  cycle: number
  insights: string | null
  top_product: string | null
  top_platform: string | null
  performance_delta: number
  created_at: string
}

interface DashboardData {
  agents: AgentState[]
  recentTasks: AgentTask[]
  evolutionHistory: EvolutionLog[]
  agentRevenue: Array<{ agent_name: string; total: number }>
}

interface CycleResult {
  ok: boolean
  cycleId?: number
  totalRevenueAdded?: number
  evolutionInsights?: string
  elapsed?: string
  error?: string
}

const AGENT_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string; border: string; desc: string }> = {
  trend_agent: {
    label: '트렌드 에이전트', icon: TrendingUp,
    color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200',
    desc: '쿠팡 트렌딩 제품 발굴 + 어필리에이트 링크 생성',
  },
  content_agent: {
    label: '콘텐츠 에이전트', icon: FileText,
    color: 'text-sky-600', bg: 'bg-sky-50', border: 'border-sky-200',
    desc: 'Claude AI 기반 훅/스크립트/이미지 프롬프트 6플랫폼 생성',
  },
  publish_agent: {
    label: '게시 에이전트', icon: Upload,
    color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200',
    desc: '예약 콘텐츠 자동 발행 + YouTube API 업로드',
  },
  revenue_agent: {
    label: '수익 에이전트', icon: DollarSign,
    color: 'text-pink-600', bg: 'bg-pink-50', border: 'border-pink-200',
    desc: '클릭/전환 추적 + 쿠팡 수수료 동기화 + 계좌 반영',
  },
  evolution_agent: {
    label: '진화 에이전트', icon: Brain,
    color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-200',
    desc: '성과 분석 → 전략 갱신 → 다음 사이클 최적화',
  },
}

function StatusDot({ status }: { status: string }) {
  if (status === 'running') return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"/>
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"/>
    </span>
  )
  if (status === 'completed') return <span className="h-2.5 w-2.5 rounded-full bg-green-500 inline-block"/>
  if (status === 'error') return <span className="h-2.5 w-2.5 rounded-full bg-red-500 inline-block"/>
  return <span className="h-2.5 w-2.5 rounded-full bg-gray-300 inline-block"/>
}

function statusLabel(s: string) {
  return { running: '실행중', completed: '완료', error: '오류', idle: '대기' }[s] || s
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function AgentCard({ agent }: { agent: AgentState }) {
  const meta = AGENT_META[agent.agent_name]
  if (!meta) return null
  const Icon = meta.icon
  const successRate = agent.total_runs > 0
    ? Math.round((agent.success_runs / agent.total_runs) * 100)
    : 0

  return (
    <Card className={`border ${meta.border} transition-shadow hover:shadow-md`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-lg ${meta.bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-5 h-5 ${meta.color}`} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <StatusDot status={agent.status} />
                <span className="font-semibold text-sm text-gray-900">{meta.label}</span>
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                agent.status === 'running' ? 'text-blue-600 bg-blue-50' :
                agent.status === 'completed' ? 'text-green-600 bg-green-50' :
                agent.status === 'error' ? 'text-red-600 bg-red-50' :
                'text-gray-500 bg-gray-50'
              }`}>{statusLabel(agent.status)}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">수익 기여</p>
            <p className="text-sm font-bold text-gray-800">
              ₩{agent.revenue_contributed.toLocaleString()}
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-500 mb-2.5 leading-relaxed">{meta.desc}</p>

        {agent.current_task && agent.status === 'running' && (
          <div className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 rounded px-2 py-1 mb-2">
            <RefreshCw className="w-3 h-3 animate-spin flex-shrink-0" />
            <span className="truncate">{agent.current_task}</span>
          </div>
        )}

        {agent.last_result && (
          <p className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5 mb-2.5 line-clamp-2">
            {agent.last_result}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-gray-400 border-t pt-2 mt-1">
          <span>실행 {agent.total_runs}회 · 성공률 {successRate}%</span>
          <span>{fmt(agent.last_run_at)}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export default function AgentsPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [running, setRunning] = useState(false)
  const [cycleResult, setCycleResult] = useState<CycleResult | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/agents/status')
    if (res.ok) setData(await res.json())
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  async function runCycle() {
    setRunning(true)
    setCycleResult(null)
    try {
      const res = await fetch('/api/agents/orchestrate', { method: 'POST' })
      const result: CycleResult = await res.json()
      setCycleResult(result)
      await load()
    } catch {
      setCycleResult({ ok: false, error: '네트워크 오류' })
    } finally {
      setRunning(false)
    }
  }

  const totalRevenue = data?.agents.reduce((s, a) => s + a.revenue_contributed, 0) || 0
  const runningCount = data?.agents.filter(a => a.status === 'running').length || 0
  const latestEvo = data?.evolutionHistory?.[0]

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Cpu className="w-6 h-6 text-indigo-600" />
            에이전트 운영 현황
          </h1>
          <p className="text-gray-500 mt-1">Bucky 오케스트레이터가 관리하는 역할별 수익 에이전트</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">
          <RefreshCw className="w-4 h-4" /> 새로고침
        </button>
      </div>

      {/* Bucky 오케스트레이터 제어 패널 */}
      <Card className="border-2 border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50">
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-5 h-5 text-indigo-600" />
                <h2 className="font-bold text-indigo-900 text-base">Bucky 오케스트레이터</h2>
                {runningCount > 0 && (
                  <Badge className="bg-blue-100 text-blue-700 border-0 animate-pulse text-xs">
                    {runningCount}개 에이전트 실행 중
                  </Badge>
                )}
              </div>
              <p className="text-sm text-indigo-700 mb-3">
                전략 수립 → 에이전트 지시 → 수익 검증 → 진화 루프 반복
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white rounded-lg p-2.5 text-center">
                  <p className="text-xs text-gray-500">에이전트 총 수익 기여</p>
                  <p className="text-lg font-bold text-indigo-700">₩{totalRevenue.toLocaleString()}</p>
                </div>
                <div className="bg-white rounded-lg p-2.5 text-center">
                  <p className="text-xs text-gray-500">총 실행 사이클</p>
                  <p className="text-lg font-bold text-indigo-700">
                    {data?.agents[0]?.total_runs || 0}회
                  </p>
                </div>
                <div className="bg-white rounded-lg p-2.5 text-center">
                  <p className="text-xs text-gray-500">진화 사이클</p>
                  <p className="text-lg font-bold text-violet-700">
                    {latestEvo?.cycle || 0}회
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 min-w-[200px]">
              <button
                onClick={runCycle}
                disabled={running}
                className="flex items-center justify-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {running
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />사이클 실행 중...</>
                  : <><Play className="w-4 h-4" />전체 사이클 실행</>}
              </button>
              <p className="text-xs text-center text-indigo-600">
                진화→트렌드→콘텐츠→게시→수익 순서 실행
              </p>
              {cycleResult && (
                <div className={`rounded-lg p-3 text-xs ${cycleResult.ok ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  {cycleResult.ok ? (
                    <>
                      <p className="font-semibold text-green-800">✓ 사이클 완료 ({cycleResult.elapsed})</p>
                      <p className="text-green-700 mt-0.5">+₩{cycleResult.totalRevenueAdded?.toLocaleString()} 수익</p>
                      {cycleResult.evolutionInsights && (
                        <p className="text-green-600 mt-1 line-clamp-2">{cycleResult.evolutionInsights.split('\n')[0]}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-red-800">✕ {cycleResult.error}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 에이전트 카드 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data?.agents.map(agent => (
          <AgentCard key={agent.agent_name} agent={agent} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 진화 로그 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-600" />
              진화 로그 (최근 5사이클)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.evolutionHistory && data.evolutionHistory.length > 0 ? (
              <div className="space-y-3">
                {data.evolutionHistory.map(e => (
                  <div key={e.id} className="border-l-2 border-violet-200 pl-3 py-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="bg-violet-100 text-violet-700 border-0 text-xs">사이클 #{e.cycle}</Badge>
                      <span className="text-xs text-gray-400">{fmt(e.created_at)}</span>
                      {e.top_platform && <Badge variant="outline" className="text-xs">{e.top_platform}</Badge>}
                    </div>
                    {e.insights && (
                      <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">
                        {e.insights.split('\n')[0]}
                      </p>
                    )}
                    {e.top_product && (
                      <p className="text-xs text-violet-600 mt-1">
                        🏆 {e.top_product.slice(0, 30)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Brain className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">첫 번째 사이클을 실행하면 진화 로그가 기록됩니다.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 최근 에이전트 작업 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-gray-600" />
              최근 작업 이력
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.recentTasks && data.recentTasks.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data.recentTasks.slice(0, 15).map(t => {
                  const meta = AGENT_META[t.agent_name]
                  return (
                    <div key={t.id} className="flex items-start gap-2.5 text-xs">
                      <div className="mt-0.5 flex-shrink-0">
                        {t.status === 'completed'
                          ? <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                          : t.status === 'failed'
                          ? <XCircle className="w-3.5 h-3.5 text-red-500" />
                          : <Clock className="w-3.5 h-3.5 text-blue-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`font-medium ${meta?.color || 'text-gray-600'}`}>
                          {meta?.label || t.agent_name}
                        </span>
                        <span className="text-gray-500 ml-1.5">{t.task_type.replace(/_/g, ' ')}</span>
                        {t.result && (
                          <p className="text-gray-400 truncate mt-0.5">{t.result}</p>
                        )}
                      </div>
                      <span className="text-gray-300 flex-shrink-0">{fmt(t.created_at)}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-center text-gray-400 py-8 text-sm">작업 이력이 없습니다.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
