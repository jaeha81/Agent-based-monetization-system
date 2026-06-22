'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock, Loader2, Upload, Video, Search, FileText, Activity } from 'lucide-react'

interface WorkflowJob {
  id: number
  workflow_name: string
  node_type: string
  trigger_type: string
  status: string
  content_id: number | null
  product_id: number | null
  render_id: string | null
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

interface AutomationRun {
  id: number
  run_type: string
  status: string
  products_found: number
  content_generated: number
  posts_published: number
  error: string | null
  started_at: string
  finished_at: string | null
}

interface ContentRow {
  id: number
  hook: string | null
  platform: string
  product_name: string | null
  render_status: string | null
  upload_status: string | null
  youtube_url: string | null
  qa_score: number | null
  created_at: string
}

interface StageStats {
  total: number
  done: number
  failed: number
}

interface PipelineData {
  jobs: WorkflowJob[]
  runs: AutomationRun[]
  recentContent: ContentRow[]
  stageStats: Record<string, StageStats>
  updatedAt: string
}

const STAGE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  product_discovery:  { label: '상품 발굴',    icon: Search,   color: 'text-violet-400' },
  content_generation: { label: '콘텐츠 생성',  icon: FileText, color: 'text-blue-400' },
  video_render:       { label: '영상 렌더',    icon: Video,    color: 'text-amber-400' },
  youtube_upload:     { label: 'YouTube 업로드', icon: Upload, color: 'text-red-400' },
}

const STATUS_BADGE: Record<string, string> = {
  done:      'bg-green-900 text-green-300',
  completed: 'bg-green-900 text-green-300',
  waiting:   'bg-yellow-900 text-yellow-300',
  running:   'bg-blue-900 text-blue-300',
  queued:    'bg-gray-700 text-gray-300',
  failed:    'bg-red-900 text-red-300',
  error:     'bg-red-900 text-red-300',
  idle:      'bg-gray-700 text-gray-400',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-gray-700 text-gray-300'
  const icon = status === 'running' ? <Loader2 size={10} className="animate-spin mr-1" />
    : status === 'done' || status === 'completed' ? <CheckCircle size={10} className="mr-1" />
    : status === 'failed' || status === 'error' ? <XCircle size={10} className="mr-1" />
    : status === 'waiting' ? <Clock size={10} className="mr-1" />
    : null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>
      {icon}{status}
    </span>
  )
}

function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

function elapsed(start: string | null, end: string | null): string {
  if (!start) return '-'
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const sec = Math.round((e - s) / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

export default function PipelinePage() {
  const [data, setData] = useState<PipelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline/status')
      const json = await res.json()
      if (json.ok) {
        setData(json)
        setLastRefresh(new Date().toLocaleTimeString('ko-KR', { hour12: false }))
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 className="animate-spin text-indigo-400" size={32} />
      </div>
    )
  }

  const { jobs = [], runs = [], recentContent = [], stageStats = {} } = data ?? {}

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">파이프라인 현황</h1>
          <p className="text-xs text-gray-400 mt-0.5">30초마다 자동 갱신 · 마지막: {lastRefresh}</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg"
        >
          <RefreshCw size={13} />
          새로고침
        </button>
      </div>

      {/* 단계별 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(STAGE_META).map(([key, meta]) => {
          const stats = stageStats[key] ?? { total: 0, done: 0, failed: 0 }
          const Icon = meta.icon
          const rate = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
          return (
            <div key={key} className="bg-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon size={16} className={meta.color} />
                <span className="text-xs font-medium text-gray-300">{meta.label}</span>
              </div>
              <p className="text-2xl font-bold text-white">{stats.done}<span className="text-sm text-gray-500">/{stats.total}</span></p>
              <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${rate}%` }} />
              </div>
              <p className="text-[10px] text-gray-500 mt-1">성공률 {rate}% · 실패 {stats.failed}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 최근 자동화 런 */}
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
            <Activity size={15} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-gray-200">자동화 실행 이력</h2>
          </div>
          <div className="divide-y divide-gray-700">
            {runs.length === 0 && (
              <p className="px-4 py-6 text-xs text-gray-500 text-center">실행 이력 없음</p>
            )}
            {runs.map(run => (
              <div key={run.id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-200">{run.run_type}</span>
                  <StatusBadge status={run.status} />
                </div>
                <div className="flex gap-4 text-[11px] text-gray-400">
                  <span>상품 {run.products_found}</span>
                  <span>콘텐츠 {run.content_generated}</span>
                  <span>게시 {run.posts_published}</span>
                  <span className="ml-auto">{fmtTime(run.started_at)} · {elapsed(run.started_at, run.finished_at)}</span>
                </div>
                {run.error && <p className="text-[10px] text-red-400 mt-1 truncate">{run.error}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* 최근 콘텐츠 렌더/업로드 현황 */}
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
            <Video size={15} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-gray-200">영상 렌더 · 업로드</h2>
          </div>
          <div className="divide-y divide-gray-700">
            {recentContent.length === 0 && (
              <p className="px-4 py-6 text-xs text-gray-500 text-center">렌더된 영상 없음</p>
            )}
            {recentContent.map(c => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-300 truncate max-w-[180px]">
                    #{c.id} {c.product_name ?? c.platform}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {c.qa_score != null && (
                      <span className={`text-[10px] font-bold ${c.qa_score >= 80 ? 'text-green-400' : c.qa_score >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                        QA {c.qa_score}
                      </span>
                    )}
                    <StatusBadge status={c.render_status ?? 'idle'} />
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-gray-400">
                  <span className="truncate max-w-[160px]">{c.hook ?? '-'}</span>
                  <span className="ml-auto flex-shrink-0">업로드: {c.upload_status ?? '-'}</span>
                </div>
                {c.youtube_url && (
                  <a href={c.youtube_url} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-indigo-400 hover:underline mt-0.5 block truncate">
                    {c.youtube_url}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* workflow_jobs 상세 */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-200">워크플로우 잡 상세 (최근 30개)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="px-4 py-2 text-left font-medium">ID</th>
                <th className="px-4 py-2 text-left font-medium">단계</th>
                <th className="px-4 py-2 text-left font-medium">트리거</th>
                <th className="px-4 py-2 text-left font-medium">상태</th>
                <th className="px-4 py-2 text-left font-medium">콘텐츠</th>
                <th className="px-4 py-2 text-left font-medium">소요</th>
                <th className="px-4 py-2 text-left font-medium">에러</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {jobs.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">잡 없음</td></tr>
              )}
              {jobs.map(job => (
                <tr key={job.id} className="hover:bg-gray-750 transition-colors">
                  <td className="px-4 py-2 text-gray-400">{job.id}</td>
                  <td className="px-4 py-2">
                    <span className={STAGE_META[job.node_type]?.color ?? 'text-gray-300'}>
                      {STAGE_META[job.node_type]?.label ?? job.node_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-400">{job.trigger_type}</td>
                  <td className="px-4 py-2"><StatusBadge status={job.status} /></td>
                  <td className="px-4 py-2 text-gray-400">{job.content_id ?? '-'}</td>
                  <td className="px-4 py-2 text-gray-400">{elapsed(job.started_at, job.completed_at)}</td>
                  <td className="px-4 py-2 text-red-400 max-w-[200px] truncate">{job.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
