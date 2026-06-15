'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Play, RefreshCw, Clock, CheckCircle, XCircle,
  TrendingUp, FileText, Upload, Activity, Zap
} from 'lucide-react'

interface AutomationStatus {
  lastRun: {
    id: number; run_type: string; status: string
    products_found: number; content_generated: number
    posts_published: number; error: string | null
    started_at: string; finished_at: string | null
  } | null
  pendingPosts: number
  todayPublished: number
  recentRuns: Array<{
    id: number; run_type: string; status: string
    products_found: number; content_generated: number
    started_at: string
  }>
  nextScheduled: Array<{
    scheduled_for: string; platform: string; product_name: string
  }>
}

interface RunResult {
  ok: boolean
  runId?: number
  productsFound?: number
  contentGenerated?: number
  scheduled?: number
  errors?: string[]
  error?: string
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <Badge className="bg-green-100 text-green-700 border-0">✓ 완료</Badge>
  if (status === 'running') return <Badge className="bg-blue-100 text-blue-700 border-0 animate-pulse">⟳ 실행중</Badge>
  if (status === 'failed') return <Badge className="bg-red-100 text-red-700 border-0">✕ 실패</Badge>
  return <Badge variant="outline">{status}</Badge>
}

function fmtTime(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function AutomationPage() {
  const [status, setStatus] = useState<AutomationStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<RunResult | null>(null)
  const [setupStatus, setSetupStatus] = useState<{
    allRequired: boolean; youtubeReady: boolean; mockMode: boolean
  } | null>(null)

  const loadStatus = useCallback(async () => {
    const [statusRes, setupRes] = await Promise.all([
      fetch('/api/automation/status'),
      fetch('/api/setup/check'),
    ])
    if (statusRes.ok) setStatus(await statusRes.json())
    if (setupRes.ok) setSetupStatus(await setupRes.json())
  }, [])

  useEffect(() => {
    loadStatus()
    const interval = setInterval(loadStatus, 15000)
    return () => clearInterval(interval)
  }, [loadStatus])

  async function runAutomation() {
    setRunning(true)
    setLastResult(null)
    try {
      const res = await fetch('/api/automation/run', { method: 'POST' })
      const data: RunResult = await res.json()
      setLastResult(data)
      await loadStatus()
    } catch {
      setLastResult({ ok: false, error: '네트워크 오류' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-indigo-600" />
            자동화 제어판
          </h1>
          <p className="text-gray-500 mt-1">24/7 자율수익화 파이프라인 모니터링 & 제어</p>
        </div>
        <button
          onClick={loadStatus}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> 새로고침
        </button>
      </div>

      {/* API 연결 상태 */}
      {setupStatus && (
        <Card className={`border-2 ${setupStatus.allRequired ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'}`}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {setupStatus.allRequired
                  ? <CheckCircle className="w-5 h-5 text-green-600" />
                  : <XCircle className="w-5 h-5 text-yellow-600" />}
                <div>
                  <p className={`font-semibold ${setupStatus.allRequired ? 'text-green-900' : 'text-yellow-900'}`}>
                    {setupStatus.allRequired ? '자동화 준비 완료' : 'API 키 설정 필요'}
                  </p>
                  <p className={`text-sm ${setupStatus.allRequired ? 'text-green-700' : 'text-yellow-700'}`}>
                    {setupStatus.mockMode ? 'Mock 모드 동작 중' : '실제 API 연동 중'}
                    {setupStatus.youtubeReady ? ' · YouTube 연결됨' : ' · YouTube 미연결'}
                  </p>
                </div>
              </div>
              {!setupStatus.allRequired && (
                <a href="/setup"
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 transition-colors">
                  설정하기
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-gray-500 font-medium">예약 대기</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{status?.pendingPosts ?? '-'}</p>
            <p className="text-xs text-gray-400 mt-0.5">게시 예정 콘텐츠</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Upload className="w-4 h-4 text-green-500" />
              <span className="text-xs text-gray-500 font-medium">오늘 게시</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{status?.todayPublished ?? '-'}</p>
            <p className="text-xs text-gray-400 mt-0.5">오늘 발행된 콘텐츠</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-violet-500" />
              <span className="text-xs text-gray-500 font-medium">최근 발굴</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {status?.lastRun?.products_found ?? '-'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">마지막 실행 제품</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-orange-500" />
              <span className="text-xs text-gray-500 font-medium">콘텐츠 생성</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {status?.lastRun?.content_generated ?? '-'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">마지막 실행 생성수</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 수동 실행 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600" />
              수동 실행
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-500">
              파이프라인을 즉시 실행합니다.<br/>
              제품 발굴 → 콘텐츠 생성 → 스케줄 등록 순으로 진행됩니다.
            </p>

            <button
              onClick={runAutomation}
              disabled={running}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {running
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> 실행 중... (최대 5분)</>
                : <><Play className="w-4 h-4" /> 지금 실행</>}
            </button>

            {lastResult && (
              <div className={`rounded-lg p-4 text-sm ${lastResult.ok ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                {lastResult.ok ? (
                  <>
                    <p className="font-semibold text-green-800 mb-2">✓ 실행 완료</p>
                    <div className="space-y-1 text-green-700">
                      <p>제품 발굴: <strong>{lastResult.productsFound}개</strong></p>
                      <p>콘텐츠 생성: <strong>{lastResult.contentGenerated}개</strong></p>
                      <p>스케줄 등록: <strong>{lastResult.scheduled}개</strong></p>
                    </div>
                    {lastResult.errors && lastResult.errors.length > 0 && (
                      <div className="mt-2 text-yellow-700">
                        <p className="font-medium">주의:</p>
                        {lastResult.errors.map((e, i) => <p key={i} className="text-xs">{e}</p>)}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-red-800">✕ 오류: {lastResult.error}</p>
                )}
              </div>
            )}

            <div className="border-t pt-3">
              <p className="text-xs font-medium text-gray-500 mb-2">Cron 스케줄 (자동)</p>
              <div className="space-y-1.5 text-xs text-gray-600">
                <div className="flex justify-between">
                  <span>매일 새벽 2시</span>
                  <span className="text-gray-400">전체 파이프라인</span>
                </div>
                <div className="flex justify-between">
                  <span>오전 9시, 오후 6시</span>
                  <span className="text-gray-400">예약 게시 발행</span>
                </div>
                <div className="flex justify-between">
                  <span>매 정시</span>
                  <span className="text-gray-400">수익 동기화</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 다음 게시 예정 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              다음 게시 예정
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status?.nextScheduled && status.nextScheduled.length > 0 ? (
              <div className="space-y-2">
                {status.nextScheduled.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{s.product_name}</p>
                      <p className="text-xs text-gray-500">{s.platform} · {fmtTime(s.scheduled_for)}</p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">{s.platform}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">예정된 게시물이 없습니다.</p>
                <p className="text-xs mt-1">자동화를 실행하면 스케줄이 생성됩니다.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 실행 이력 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">실행 이력</CardTitle>
        </CardHeader>
        <CardContent>
          {status?.recentRuns && status.recentRuns.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 text-left text-xs text-gray-500 font-medium">ID</th>
                    <th className="pb-2 text-left text-xs text-gray-500 font-medium">유형</th>
                    <th className="pb-2 text-left text-xs text-gray-500 font-medium">상태</th>
                    <th className="pb-2 text-right text-xs text-gray-500 font-medium">제품</th>
                    <th className="pb-2 text-right text-xs text-gray-500 font-medium">콘텐츠</th>
                    <th className="pb-2 text-left text-xs text-gray-500 font-medium">시작 시각</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {status.recentRuns.map(run => (
                    <tr key={run.id} className="hover:bg-gray-50">
                      <td className="py-2 text-gray-400">#{run.id}</td>
                      <td className="py-2 text-gray-600">{run.run_type}</td>
                      <td className="py-2"><StatusBadge status={run.status} /></td>
                      <td className="py-2 text-right text-gray-700">{run.products_found}</td>
                      <td className="py-2 text-right text-gray-700">{run.content_generated}</td>
                      <td className="py-2 text-gray-500 text-xs">{fmtTime(run.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-400 py-6 text-sm">아직 실행 이력이 없습니다.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
