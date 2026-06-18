'use client'

import { useState, useEffect, useCallback } from 'react'

interface ManualEntry {
  id: number
  platform: string
  source: string
  amount: number
  period: string
  note: string | null
  created_at: string
}

interface VideoStat {
  youtube_video_id: string
  views: number
  product_name: string
  posted_at: string | null
}

interface ManualData {
  entries: ManualEntry[]
  total: number
  byPlatform: Record<string, number>
}

interface YouTubeData {
  analytics: {
    rows: Array<{ date: string; views: number; estimatedRevenue: number }>
    totalRevenue: number
    totalViews: number
    hasMonetization: boolean
  }
  videoStats: VideoStat[]
  totalViewsFromDb: number
  credentialSet: boolean
}

const SOURCE_OPTIONS: Record<string, string[]> = {
  '쿠팡 파트너스': ['쿠팡 파트너스 수수료', '쿠팡 로켓배송 보너스', '쿠팡 전환 보너스'],
  'YouTube AdSense': ['YouTube 광고 수익', 'YouTube 채널멤버십', 'YouTube Super Chat'],
  '기타': ['블로그 광고', '네이버 블로그', '직접 광고주'],
}

export default function RevenuePage() {
  const [manualData, setManualData] = useState<ManualData | null>(null)
  const [youtubeData, setYoutubeData] = useState<YouTubeData | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    platform: '쿠팡 파트너스',
    source: '쿠팡 파트너스 수수료',
    amount: '',
    period: new Date().toISOString().slice(0, 7),
    note: '',
  })
  const [activeTab, setActiveTab] = useState<'coupang' | 'youtube'>('coupang')

  const fetchData = useCallback(async () => {
    const [manual, youtube] = await Promise.all([
      fetch('/api/revenue/manual').then(r => r.json()),
      fetch('/api/revenue/youtube?days=30').then(r => r.json()),
    ])
    setManualData(manual)
    setYoutubeData(youtube)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/revenue/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: parseInt(form.amount) }),
      })
      if (res.ok) {
        setShowForm(false)
        setForm(f => ({ ...f, amount: '', note: '' }))
        await fetchData()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return
    await fetch(`/api/revenue/manual?id=${id}`, { method: 'DELETE' })
    await fetchData()
  }

  const totalManual = manualData?.total ?? 0
  const coupangTotal = manualData?.byPlatform['쿠팡 파트너스'] ?? 0
  const ytAnalyticsRevenue = youtubeData?.analytics.totalRevenue ?? 0
  const ytTotalViews = youtubeData?.totalViewsFromDb ?? 0
  const grandTotal = totalManual + ytAnalyticsRevenue

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">수익 관리</h2>
          <p className="text-sm text-gray-500 mt-0.5">쿠팡 파트너스 + YouTube AdSense 실제 수익 현황</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="text-sm px-4 py-2 bg-yellow-500 text-gray-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors"
        >
          + 수익 입력
        </button>
      </div>

      {/* KPI 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="총 수익 합계" value={`${(grandTotal / 10000).toFixed(0)}만원`} sub="수동 입력 기준" color="yellow" />
        <KPICard label="쿠팡 파트너스" value={`${(coupangTotal / 10000).toFixed(0)}만원`} sub="누적 수수료" color="orange" />
        <KPICard label="YouTube 광고" value={ytAnalyticsRevenue > 0 ? `${(ytAnalyticsRevenue / 10000).toFixed(0)}만원` : '미연동'} sub={youtubeData?.analytics.hasMonetization ? '최근 30일' : '수익창출 미적용'} color="red" />
        <KPICard label="YouTube 조회수" value={ytTotalViews > 0 ? `${(ytTotalViews / 10000).toFixed(1)}만회` : '0'} sub="게시 영상 누계" color="blue" />
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([['coupang', '쿠팡 파트너스'], ['youtube', 'YouTube']] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === tab ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 쿠팡 탭 */}
      {activeTab === 'coupang' && (
        <div className="space-y-4">
          {/* 안내 박스 */}
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-orange-800 mb-1">쿠팡 파트너스 수수료 확인 방법</p>
            <ol className="text-xs text-orange-700 space-y-1 list-decimal list-inside">
              <li>partners.coupang.com 접속 → 수익 현황 메뉴</li>
              <li>기간별 수수료 금액 확인 (매월 15일 정산)</li>
              <li>아래 &quot;+ 수익 입력&quot; 버튼으로 금액을 직접 입력</li>
            </ol>
            <p className="text-xs text-orange-600 mt-2">※ 쿠팡 파트너스는 공개 API를 제공하지 않아 수동 입력이 필요합니다.</p>
          </div>

          {/* 수익 입력 내역 */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">수익 입력 내역</h3>
            </div>
            {!manualData || manualData.entries.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-400 text-sm">입력된 수익이 없습니다.</p>
                <button
                  onClick={() => setShowForm(true)}
                  className="mt-3 text-sm text-orange-600 underline"
                >
                  쿠팡 수수료 입력하기
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="px-5 py-3 font-medium">플랫폼</th>
                      <th className="px-5 py-3 font-medium">항목</th>
                      <th className="px-5 py-3 font-medium">정산 기간</th>
                      <th className="px-5 py-3 font-medium text-right">금액</th>
                      <th className="px-5 py-3 font-medium">메모</th>
                      <th className="px-5 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {manualData.entries.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">{e.platform}</span>
                        </td>
                        <td className="px-5 py-3 text-gray-700">{e.source}</td>
                        <td className="px-5 py-3 text-gray-500">{e.period}</td>
                        <td className="px-5 py-3 text-right font-semibold text-yellow-600">
                          {e.amount >= 10000 ? `${(e.amount / 10000).toFixed(0)}만원` : `${e.amount.toLocaleString()}원`}
                        </td>
                        <td className="px-5 py-3 text-gray-400 text-xs">{e.note || '-'}</td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => handleDelete(e.id)}
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-orange-50 border-t border-orange-100">
                      <td colSpan={3} className="px-5 py-3 font-semibold text-gray-700">합계</td>
                      <td className="px-5 py-3 text-right font-bold text-orange-700 text-base">
                        {totalManual >= 10000 ? `${(totalManual / 10000).toFixed(0)}만원` : `${totalManual.toLocaleString()}원`}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* YouTube 탭 */}
      {activeTab === 'youtube' && (
        <div className="space-y-4">
          {/* AdSense 상태 */}
          {youtubeData && !youtubeData.analytics.hasMonetization && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-blue-800 mb-1">YouTube AdSense 수익 조회 안내</p>
              <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                <li>YouTube Studio → 수익 창출 메뉴에서 AdSense 계정 연결 필요</li>
                <li>구독자 500명 + 최근 90일 조회수 3,000시간 이상 시 수익 창출 신청 가능</li>
                <li>OAuth 갱신 시 <code className="bg-blue-100 px-1 rounded">yt-analytics-monetary.readonly</code> 스코프 추가 필요</li>
              </ol>
              <p className="text-xs text-blue-600 mt-2">현재는 실제 업로드된 영상의 조회수만 추적됩니다.</p>
            </div>
          )}

          {youtubeData?.analytics.hasMonetization && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-800">YouTube AdSense 추정 수익 (최근 30일)</p>
              <p className="text-3xl font-bold text-red-600 mt-2">
                {ytAnalyticsRevenue > 0
                  ? `${(ytAnalyticsRevenue / 10000).toFixed(1)}만원`
                  : '0원'}
              </p>
              <p className="text-xs text-red-500 mt-1">※ 1USD = 1,380원 기준 추정치. 실제 지급액과 다를 수 있습니다.</p>
            </div>
          )}

          {/* 업로드된 영상 조회수 */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">업로드된 YouTube 영상</h3>
              <span className="text-xs text-gray-400">revenue-sync 크론 매일 06:00 KST 업데이트</span>
            </div>
            {!youtubeData || youtubeData.videoStats.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-400 text-sm">업로드된 YouTube 영상이 없습니다.</p>
                <p className="text-xs text-gray-400 mt-1">자동화 실행 후 YouTube에 비공개 영상이 업로드되면 여기에 표시됩니다.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="px-5 py-3 font-medium">제품명</th>
                      <th className="px-5 py-3 font-medium">영상 ID</th>
                      <th className="px-5 py-3 font-medium">업로드일</th>
                      <th className="px-5 py-3 font-medium text-right">조회수</th>
                      <th className="px-5 py-3 font-medium">링크</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {youtubeData.videoStats.map(v => (
                      <tr key={v.youtube_video_id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 text-gray-800 font-medium max-w-[200px] truncate">{v.product_name}</td>
                        <td className="px-5 py-3 text-gray-400 font-mono text-xs">{v.youtube_video_id}</td>
                        <td className="px-5 py-3 text-gray-500 text-xs">
                          {v.posted_at ? new Date(v.posted_at).toLocaleDateString('ko-KR') : '-'}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold text-gray-800">
                          {v.views >= 10000
                            ? `${(v.views / 10000).toFixed(1)}만`
                            : v.views.toLocaleString()}
                        </td>
                        <td className="px-5 py-3">
                          <a
                            href={`https://www.youtube.com/shorts/${v.youtube_video_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-red-600 hover:underline"
                          >
                            YouTube Studio →
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* YouTube 수동 입력 안내 */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-700 mb-1">YouTube AdSense 수익 수동 입력</p>
            <p className="text-xs text-gray-500">AdSense 수익은 위 &quot;+ 수익 입력&quot; 버튼에서 플랫폼을 &quot;YouTube AdSense&quot;로 선택해 입력할 수 있습니다.</p>
          </div>
        </div>
      )}

      {/* 수익 입력 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <h3 className="font-bold text-lg">수익 입력</h3>
              <p className="text-sm text-gray-500 mt-0.5">partners.coupang.com 또는 AdSense에서 확인한 수익을 입력하세요</p>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">플랫폼</label>
                <select
                  value={form.platform}
                  onChange={e => setForm(f => ({ ...f, platform: e.target.value, source: SOURCE_OPTIONS[e.target.value]?.[0] || '' }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  {Object.keys(SOURCE_OPTIONS).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">항목</label>
                <select
                  value={form.source}
                  onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  {(SOURCE_OPTIONS[form.platform] || []).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">정산 기간 (연-월)</label>
                <input
                  type="month"
                  value={form.period}
                  onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">금액 (원)</label>
                <input
                  type="number"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="예: 150000"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  required
                  min="1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1 block">메모 (선택)</label>
                <input
                  type="text"
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="예: 뷰티 카테고리 수수료"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-yellow-500 text-gray-900 rounded-lg py-2 text-sm font-semibold hover:bg-yellow-400 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function KPICard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colorMap: Record<string, string> = {
    yellow: 'text-yellow-600',
    orange: 'text-orange-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
  }
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-200">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colorMap[color] || 'text-gray-800'}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  )
}
