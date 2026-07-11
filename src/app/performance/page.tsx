'use client'

import { useEffect, useState } from 'react'

interface VideoPerformance {
  content_id: number
  youtube_video_id: string
  hook: string | null
  product_name: string
  music_title: string | null
  status: string
  visibility: string | null
  qa_status: string
  qa_score: number
  views: number
  engaged_views: number
  likes: number
  click_count: number
  avg_view_duration: number
  avg_view_percentage: number
  performance_score: number
  click_rate: number
  like_rate: number
  sample_status: 'reliable' | 'learning'
  retention_stages: number[]
}

interface PerformanceData {
  summary: {
    videos: number
    reliableVideos: number
    totalViews: number
    totalClicks: number
    avgRetention: number
    avgScore: number
    clickSignalReliable: boolean
  }
  videos: VideoPerformance[]
  trendKeywords: Array<{ keyword: string; score: number; total_views: number }>
  trendVideos: Array<{ external_id: string; title: string; view_count: number; shopping_relevant: number; view_velocity: number }>
  music: Array<{ id: string; title: string; artist: string; license: string; uses: number; avg_retention: number; avg_click_rate: number; performance_score: number; observed_videos: number; observed_views: number; evidence_confidence: number }>
  products: Array<{ id: number; name: string; total_views: number; actual_revenue: number; total_cost: number; net_profit: number; profit_score: number; performance_score: number; selection_score: number; decision_confidence: number; decision_action: string; decision_reason: string | null; market_trend_score: number; market_trend_reason: string | null; stopped: boolean }>
  freshness: { latestTrendAt: string | null; staleTrend: boolean }
}

export default function PerformancePage() {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/performance')
      .then(async response => {
        if (!response.ok) throw new Error('성과 데이터를 불러오지 못했습니다.')
        return response.json()
      })
      .then(setData)
      .catch(error => setError(error instanceof Error ? error.message : String(error)))
  }, [])

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>
  if (!data) return <div className="p-8 text-sm text-gray-400">성과 데이터 불러오는 중…</div>

  const { summary, videos, trendKeywords, trendVideos, music, products, freshness } = data
  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h2 className="text-xl font-bold">자가루프 성과 분석</h2>
        <p className="text-sm text-gray-500 mt-1">검증된 참여 시청·수익·반응을 근거로 다음 상품 선택을 검증합니다.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Metric label="분석 영상" value={`${summary.videos}개`} />
        <Metric label="신뢰 표본" value={`${summary.reliableVideos}개`} sub="참여 시청 300 이상" />
        <Metric label="누적 조회" value={summary.totalViews.toLocaleString()} />
        <Metric label="상품 클릭" value={summary.clickSignalReliable ? summary.totalClicks.toLocaleString() : '비활성'} sub={summary.clickSignalReliable ? '클릭 가능 표면' : 'Shorts 링크 제약'} />
        <Metric label="평균 유지율" value={`${summary.avgRetention.toFixed(1)}%`} sub={`평균 점수 ${summary.avgScore.toFixed(1)}`} />
      </div>

      {summary.reliableVideos === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          아직 참여 시청 300회 이상인 영상이 없어 자가루프가 학습 단계입니다. 표본이 쌓이기 전에는 성과점수를 확정 판단으로 사용하지 않습니다.
        </div>
      )}

      {freshness.staleTrend && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">외부 시장 트렌드가 48시간 이상 갱신되지 않았습니다. YOUTUBE_API_KEY와 daily cron을 확인하세요.</div>}

      <div className="grid lg:grid-cols-2 gap-4">
        <InsightCard title="한국 시장 급상승 키워드">
          <div className="flex flex-wrap gap-2">{trendKeywords.map(item => <span key={item.keyword} className="rounded-full bg-red-50 px-3 py-1 text-xs text-red-700">{item.keyword} · {Math.round(item.score)}</span>)}</div>
          {trendKeywords.length === 0 && <Empty text="시장 신호 수집 전" />}
        </InsightCard>
        <InsightCard title="쇼핑 연관 인기 영상">
          <div className="space-y-2">{trendVideos.filter(video => video.shopping_relevant).slice(0, 5).map(video => <a key={video.external_id} href={`https://youtube.com/watch?v=${video.external_id}`} target="_blank" rel="noreferrer" className="block text-sm text-gray-700 hover:text-red-600 truncate">{video.title} <span className="text-xs text-gray-400">{video.view_count.toLocaleString()}회 · 시간당 +{Math.round(Number(video.view_velocity || 0)).toLocaleString()}</span></a>)}</div>
          {!trendVideos.some(video => video.shopping_relevant) && <Empty text="쇼핑 연관 인기 영상 없음" />}
        </InsightCard>
        <InsightCard title="음악 성과 순위">
          <div className="space-y-2">{music.map(track => <div key={track.id} className="text-sm"><div className="flex justify-between gap-3"><span className="truncate">{track.title} · {track.artist}<span className="ml-1 text-[10px] text-gray-400">{track.license}</span></span><span className="whitespace-nowrap font-medium text-violet-600">{Number(track.performance_score || 0).toFixed(1)}점 · {track.uses}회</span></div><p className="text-[11px] text-gray-400">검증 {track.observed_videos || 0}편 / {(track.observed_views || 0).toLocaleString()}뷰 · 신뢰도 {Math.round(Number(track.evidence_confidence || 0) * 100)}%</p></div>)}</div>
        </InsightCard>
        <InsightCard title="상품 순이익 및 중단 후보">
          <div className="space-y-3">{products.slice(0, 8).map(product => <div key={product.id} className="text-sm"><div className="flex justify-between gap-3"><span className="truncate">{product.name}<span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${product.stopped ? 'bg-red-100 text-red-700' : product.decision_action === 'scale' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{product.decision_action || 'learn'}</span></span><span className={`whitespace-nowrap font-semibold ${product.net_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{product.net_profit.toLocaleString()}원</span></div><p className="mt-1 truncate text-[11px] text-gray-400">선택 {Number(product.selection_score || 0).toFixed(1)}점 · 신뢰도 {Math.round(Number(product.decision_confidence || 0) * 100)}% · 시장 {Number(product.market_trend_score || 0).toFixed(1)}점</p><p className="truncate text-[11px] text-gray-400">{product.market_trend_reason || product.decision_reason || '판단 대기'}</p></div>)}</div>
        </InsightCard>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h3 className="font-semibold">영상별 수익 기여 신호</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">상품 / 훅</th>
                  <th className="text-right px-4 py-3">조회/참여</th>
                <th className="text-right px-4 py-3">유지율</th>
                <th className="text-right px-4 py-3">평균 시청</th>
                <th className="text-right px-4 py-3">클릭률</th>
                <th className="text-right px-4 py-3">반응률</th>
                <th className="text-right px-4 py-3">점수</th>
                <th className="text-center px-4 py-3">표본 / 공개</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {videos.map(video => (
                <tr key={video.content_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 max-w-[280px]">
                    <a className="font-medium text-gray-900 hover:text-red-600" href={`https://youtube.com/shorts/${video.youtube_video_id}`} target="_blank" rel="noreferrer">{video.product_name}</a>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{video.hook || '훅 없음'}</p>
                    <p className="text-[11px] text-violet-500 truncate mt-0.5">음악: {video.music_title || '배정 정보 없음'}</p>
                    {video.retention_stages.some(value => value > 0) && <p className="text-[11px] text-blue-500 truncate mt-0.5">구간 유지 0·3·9·15·20초: {video.retention_stages.map(value => `${value.toFixed(0)}%`).join(' → ')}</p>}
                  </td>
                  <td className="text-right px-4 py-3">{video.views.toLocaleString()} / {video.engaged_views.toLocaleString()}</td>
                  <td className="text-right px-4 py-3 font-medium">{video.avg_view_percentage.toFixed(1)}%</td>
                  <td className="text-right px-4 py-3">{video.avg_view_duration.toFixed(1)}초</td>
                  <td className="text-right px-4 py-3">{video.click_rate.toFixed(2)}%</td>
                  <td className="text-right px-4 py-3">{video.like_rate.toFixed(2)}%</td>
                  <td className="text-right px-4 py-3 font-bold text-blue-600">{video.performance_score.toFixed(1)}</td>
                  <td className="text-center px-4 py-3 text-xs">
                    <span className={`inline-block rounded-full px-2 py-0.5 ${video.sample_status === 'reliable' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{video.sample_status === 'reliable' ? '신뢰' : '학습중'}</span>
                    <span className="block text-gray-400 mt-1">QA {video.qa_status} {video.qa_score || 0} · {video.visibility || 'private'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {videos.length === 0 && <div className="p-10 text-center text-sm text-gray-400">YouTube 업로드 데이터가 없습니다.</div>}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500">{label}</p><p className="text-2xl font-bold mt-1">{value}</p>{sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}</div>
}

function InsightCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-gray-200 bg-white p-5"><h3 className="font-semibold mb-3">{title}</h3>{children}</section>
}

function Empty({ text }: { text: string }) { return <p className="text-sm text-gray-400">{text}</p> }
