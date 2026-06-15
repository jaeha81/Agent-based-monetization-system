'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts'
import {
  DollarSign, TrendingUp, Target, BarChart2, ArrowDownRight, Building2, Plus, Trash2, CheckCircle
} from 'lucide-react'

interface RevenueStructure {
  byProduct: Array<{ name: string; category: string; commission_rate: number; total_revenue: number; total_views: number; content_count: number; rpm: number }>
  byPlatform: Array<{ platform: string; total_revenue: number; total_views: number; content_count: number; avg_revenue_per_post: number }>
  byCategory: Array<{ category: string; total_revenue: number; total_views: number; product_count: number; avg_commission: number }>
  funnel: { products_discovered: number; content_created: number; content_scheduled: number; content_posted: number; total_views: number; total_clicks: number; total_revenue: number }
  weeklyTrend: Array<{ date: string; revenue: number; commission_type: string }>
  agentContrib: Array<{ agent_name: string; revenue_contributed: number; total_runs: number; success_runs: number }>
  accounts: Array<{ id: number; account_type: string; account_name: string | null; bank_name: string | null; account_number_masked: string | null; is_verified: number; total_received: number; last_settled_at: string | null }>
}

const PLATFORM_COLORS: Record<string, string> = {
  YouTube: '#ef4444', TikTok: '#000', Instagram: '#e1306c',
  Facebook: '#1877f2', Threads: '#000', Naver: '#03c75a',
}

const AGENT_LABELS: Record<string, string> = {
  trend_agent: '트렌드', content_agent: '콘텐츠',
  publish_agent: '게시', revenue_agent: '수익', evolution_agent: '진화',
}

const CATEGORY_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']

function KPI({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>; color: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-xs text-gray-500 font-medium">{label}</span>
        </div>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function AccountForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState({ account_type: 'coupang_partners', account_name: '', bank_name: '', account_number: '', account_holder: '' })
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/accounts/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const d = await res.json()
      if (d.ok) { setMsg('✓ 등록 완료'); setForm({ account_type: 'coupang_partners', account_name: '', bank_name: '', account_number: '', account_holder: '' }); onAdded() }
      else setMsg(`✕ ${d.error}`)
    } finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">계좌 유형</label>
          <select value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="coupang_partners">쿠팡 파트너스</option>
            <option value="youtube_adsense">YouTube 애드센스</option>
            <option value="naver_blog">네이버 블로그</option>
            <option value="tiktok_creator">TikTok 크리에이터</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">계정명 / 아이디</label>
          <input value={form.account_name} onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))}
            placeholder="coupang_id@email.com" required
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">은행명</label>
          <input value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))}
            placeholder="신한은행"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">계좌번호</label>
          <input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))}
            placeholder="110-123-456789" type="password"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 mb-1 block">예금주</label>
          <input value={form.account_holder} onChange={e => setForm(f => ({ ...f, account_holder: e.target.value }))}
            placeholder="홍길동"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          <Plus className="w-4 h-4" />{loading ? '등록 중...' : '계좌 등록'}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{msg}</span>}
      </div>
    </form>
  )
}

export default function RevenueStructurePage() {
  const [data, setData] = useState<RevenueStructure | null>(null)
  const [activeTab, setActiveTab] = useState<'product' | 'platform' | 'funnel' | 'account'>('platform')

  const load = useCallback(async () => {
    const res = await fetch('/api/revenue/structure')
    if (res.ok) setData(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  async function deleteAccount(id: number) {
    await fetch(`/api/accounts/register?id=${id}`, { method: 'DELETE' })
    load()
  }

  const totalRevenue = data?.byPlatform.reduce((s, p) => s + p.total_revenue, 0) || 0
  const totalViews = data?.funnel?.total_views || 0
  const totalClicks = data?.funnel?.total_clicks || 0

  const trendData = data?.weeklyTrend.reduce((acc: Record<string, { date: string; revenue: number }>, r) => {
    if (!acc[r.date]) acc[r.date] = { date: r.date, revenue: 0 }
    acc[r.date].revenue += r.revenue
    return acc
  }, {})
  const trendArr = Object.values(trendData || {}).sort((a, b) => a.date.localeCompare(b.date))

  const TABS = [
    { id: 'platform', label: '플랫폼별' },
    { id: 'product', label: '제품별' },
    { id: 'funnel', label: '퍼널 분석' },
    { id: 'account', label: '계좌 관리' },
  ] as const

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart2 className="w-6 h-6 text-indigo-600" />
          수익 구조 분석
        </h1>
        <p className="text-gray-500 mt-1">플랫폼 · 제품 · 에이전트별 수익 구조와 퍼널 분석</p>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="총 수익" value={`₩${totalRevenue.toLocaleString()}`} icon={DollarSign} color="text-green-600" sub="전체 기간" />
        <KPI label="총 조회수" value={totalViews.toLocaleString()} icon={TrendingUp} color="text-blue-600" sub="게시된 콘텐츠" />
        <KPI label="클릭 추적" value={totalClicks.toLocaleString()} icon={Target} color="text-orange-600" sub="어필리에이트 클릭" />
        <KPI label="전환율" value={totalViews > 0 ? `${((totalClicks / totalViews) * 100).toFixed(2)}%` : '0%'} icon={ArrowDownRight} color="text-violet-600" sub="조회→클릭" />
      </div>

      {/* 수익 트렌드 그래프 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">수익 트렌드 (최근 30일)</CardTitle>
        </CardHeader>
        <CardContent>
          {trendArr.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trendArr}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₩${(v / 1000).toFixed(0)}K`} />
                <Tooltip formatter={(v) => [`₩${Number(v).toLocaleString()}`, '수익']} labelFormatter={l => `날짜: ${l}`} />
                <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">
              데이터 누적 중...
            </div>
          )}
        </CardContent>
      </Card>

      {/* 탭 */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 플랫폼별 */}
      {activeTab === 'platform' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">플랫폼별 수익 분포</CardTitle></CardHeader>
            <CardContent>
              {data?.byPlatform && data.byPlatform.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={data.byPlatform} dataKey="total_revenue" nameKey="platform" cx="50%" cy="50%" outerRadius={80} label={(props) => `${props.name} ${((props.percent || 0) * 100).toFixed(0)}%`}>
                      {data.byPlatform.map((entry, i) => (
                        <Cell key={i} fill={PLATFORM_COLORS[entry.platform] || CATEGORY_COLORS[i % 6]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => `₩${Number(v).toLocaleString()}`} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">데이터 없음</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">플랫폼별 상세</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data?.byPlatform.map((p, i) => {
                  const pct = totalRevenue > 0 ? (p.total_revenue / totalRevenue) * 100 : 0
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: PLATFORM_COLORS[p.platform] || '#94a3b8' }} />
                          <span className="font-medium">{p.platform}</span>
                          <span className="text-gray-400 text-xs">{p.content_count}개</span>
                        </div>
                        <span className="font-semibold">₩{p.total_revenue.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: PLATFORM_COLORS[p.platform] || '#94a3b8' }} />
                      </div>
                      <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                        <span>평균 ₩{Math.round(p.avg_revenue_per_post).toLocaleString()}/포스트</span>
                        <span>{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 제품별 */}
      {activeTab === 'product' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">카테고리별 수익</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data?.byCategory || []} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `₩${(v / 10000).toFixed(0)}만`} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={55} />
                  <Tooltip formatter={(v) => `₩${Number(v).toLocaleString()}`} />
                  <Bar dataKey="total_revenue" radius={[0, 4, 4, 0]}>
                    {(data?.byCategory || []).map((_, i) => (
                      <Cell key={i} fill={CATEGORY_COLORS[i % 6]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">상위 수익 제품 TOP 10</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data?.byProduct.map((p, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm p-2 rounded-lg hover:bg-gray-50">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs flex items-center justify-center font-bold flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{p.name}</p>
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <Badge variant="outline" className="text-xs py-0">{p.category}</Badge>
                        <span>수수료 {p.commission_rate}%</span>
                        <span>RPM ₩{(p.rpm || 0).toFixed(0)}</span>
                      </div>
                    </div>
                    <span className="font-bold text-green-600 flex-shrink-0">₩{p.total_revenue.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 퍼널 분석 */}
      {activeTab === 'funnel' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">수익 창출 퍼널</CardTitle></CardHeader>
            <CardContent>
              {data?.funnel && (
                <div className="space-y-3">
                  {[
                    { label: '제품 발굴', value: data.funnel.products_discovered, color: 'bg-indigo-500', pct: 100 },
                    { label: '콘텐츠 생성', value: data.funnel.content_created, color: 'bg-sky-500', pct: Math.min(100, (data.funnel.content_created / Math.max(data.funnel.products_discovered, 1)) * 100) },
                    { label: '스케줄 등록', value: data.funnel.content_scheduled, color: 'bg-emerald-500', pct: Math.min(100, (data.funnel.content_scheduled / Math.max(data.funnel.content_created, 1)) * 100) },
                    { label: '게시 완료', value: data.funnel.content_posted, color: 'bg-amber-500', pct: Math.min(100, (data.funnel.content_posted / Math.max(data.funnel.content_scheduled, 1)) * 100) },
                    { label: '총 조회수', value: data.funnel.total_views, color: 'bg-orange-500', pct: 80 },
                    { label: '클릭(전환)', value: data.funnel.total_clicks, color: 'bg-pink-500', pct: data.funnel.total_views > 0 ? (data.funnel.total_clicks / data.funnel.total_views) * 2000 : 0 },
                    { label: '수익 발생', value: `₩${data.funnel.total_revenue.toLocaleString()}`, color: 'bg-green-500', pct: 60 },
                  ].map((step, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-700">{step.label}</span>
                        <span className="font-bold text-gray-900">{typeof step.value === 'number' ? step.value.toLocaleString() : step.value}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-4">
                        <div className={`h-4 rounded-full ${step.color} transition-all`} style={{ width: `${Math.max(2, Math.min(100, step.pct))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">에이전트별 수익 기여도</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data?.agentContrib.filter(a => a.revenue_contributed > 0).map((a, i) => {
                  const total = data.agentContrib.reduce((s, x) => s + x.revenue_contributed, 0)
                  const pct = total > 0 ? (a.revenue_contributed / total) * 100 : 0
                  return (
                    <div key={i}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{AGENT_LABELS[a.agent_name] || a.agent_name} 에이전트</span>
                        <span className="font-bold">₩{a.revenue_contributed.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{a.total_runs}회 실행 · 성공율 {a.total_runs > 0 ? Math.round((a.success_runs / a.total_runs) * 100) : 0}%</p>
                    </div>
                  )
                })}
                {(!data?.agentContrib.some(a => a.revenue_contributed > 0)) && (
                  <p className="text-center text-gray-400 py-6 text-sm">에이전트 사이클 실행 후 데이터가 표시됩니다.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 계좌 관리 */}
      {activeTab === 'account' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-600" />
                수익 계좌 등록
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AccountForm onAdded={load} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">등록된 계좌</CardTitle>
            </CardHeader>
            <CardContent>
              {data?.accounts && data.accounts.length > 0 ? (
                <div className="space-y-3">
                  {data.accounts.map(acc => (
                    <div key={acc.id} className="flex items-start gap-3 p-3 border rounded-lg">
                      <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                        <DollarSign className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-sm text-gray-800">{acc.account_name || acc.account_type}</span>
                          <Badge variant="outline" className="text-xs">
                            {acc.account_type === 'coupang_partners' ? '쿠팡 파트너스' :
                              acc.account_type === 'youtube_adsense' ? 'YouTube 애드센스' :
                              acc.account_type}
                          </Badge>
                          {acc.is_verified ? (
                            <Badge className="text-xs bg-green-100 text-green-700 border-0">
                              <CheckCircle className="w-3 h-3 mr-0.5" /> 검증됨
                            </Badge>
                          ) : (
                            <Badge className="text-xs bg-yellow-100 text-yellow-700 border-0">검증 대기</Badge>
                          )}
                        </div>
                        {acc.bank_name && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {acc.bank_name} {acc.account_number_masked}
                          </p>
                        )}
                        <p className="text-xs text-green-600 font-medium mt-1">
                          정산 수령: ₩{acc.total_received.toLocaleString()}
                        </p>
                      </div>
                      <button onClick={() => deleteAccount(acc.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">등록된 계좌가 없습니다.</p>
                  <p className="text-xs mt-1">왼쪽에서 수익 계좌를 등록하세요.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
