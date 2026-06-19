import { getRevenueSummary } from '@/lib/agents/revenue-agent'
import { getAutomationStatus } from '@/lib/automation-engine'
import { getActiveMarkets } from '@/lib/markets'
import KPICards from '@/components/dashboard/KPICards'
import { RevenueAreaChart, PlatformPieChart } from '@/components/dashboard/RevenueChart'
import TopContent from '@/components/dashboard/TopContent'
import YouTubeUploads from '@/components/dashboard/YouTubeUploads'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [summary, autoStatus, activeMarkets] = await Promise.all([
    getRevenueSummary(),
    getAutomationStatus(),
    Promise.resolve(getActiveMarkets()),
  ])

  const lastRunStatus = autoStatus.lastRun?.status
  const MARKET_FLAGS: Record<string, string> = { KR: '🇰🇷', US: '🇺🇸', JP: '🇯🇵', GB: '🇬🇧', DE: '🇩🇪', AU: '🇦🇺' }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">수익화 현황</h2>
          <p className="text-sm text-gray-500 mt-0.5">쇼핑숏츠 에이전트 자동화 시스템</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
            <span className="text-xs text-gray-500">활성 마켓</span>
            <div className="flex gap-1">
              {activeMarkets.map(m => (
                <span key={m} className="text-base" title={m}>{MARKET_FLAGS[m] || m}</span>
              ))}
            </div>
          </div>
          <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border ${
            lastRunStatus === 'completed' ? 'bg-green-50 text-green-700 border-green-200' :
            lastRunStatus === 'running' ? 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse' :
            lastRunStatus === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
            'bg-gray-50 text-gray-500 border-gray-200'
          }`}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{
              backgroundColor: lastRunStatus === 'completed' ? '#16a34a' : lastRunStatus === 'running' ? '#2563eb' : lastRunStatus === 'failed' ? '#dc2626' : '#9ca3af'
            }}/>
            자동화 {lastRunStatus === 'completed' ? '완료' : lastRunStatus === 'running' ? '실행중' : lastRunStatus === 'failed' ? '실패' : '대기'}
          </div>
          <Link href="/automation" className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors">
            지금 실행 →
          </Link>
        </div>
      </div>

      <KPICards
        totalRevenue={summary.totalRevenue}
        monthlyRevenue={summary.monthlyRevenue}
        activeAccounts={summary.activeAccounts}
        totalContent={summary.totalContent}
        growthRate={summary.growthRate}
      />

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white rounded-xl p-5 border border-gray-200">
          <h3 className="font-semibold text-gray-800 mb-4">최근 30일 수익 추이</h3>
          <RevenueAreaChart data={summary.dailyData} />
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200">
          <h3 className="font-semibold text-gray-800 mb-4">플랫폼별 수익</h3>
          <PlatformPieChart data={summary.platformData} />
          <div className="mt-3 space-y-1">
            {summary.platformData.slice(0, 4).map(p => (
              <div key={p.platform} className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{p.platform}</span>
                <span className="font-medium">{p.percentage}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200">
          <h3 className="font-semibold text-gray-800 mb-4">TOP 수익 콘텐츠</h3>
          <TopContent data={summary.topContent} />
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200">
          <h3 className="font-semibold text-gray-800 mb-4">이번 달 요약</h3>
          <div className="space-y-3">
            <SummaryRow label="이번 달 수익" value={`${(summary.monthlyRevenue / 10000).toFixed(0)}만원`} />
            <SummaryRow label="이번 주 수익" value={`${(summary.weeklyRevenue / 10000).toFixed(0)}만원`} />
            <SummaryRow label="오늘 수익" value={`${summary.todayRevenue.toLocaleString()}원`} />
            <SummaryRow label="활성 계정" value={`${summary.activeAccounts}개`} />
            <SummaryRow label="상위 플랫폼" value={summary.topPlatform} />
            <SummaryRow label="총 콘텐츠" value={`${summary.totalContent}개`} highlight />
          </div>

          {summary.totalContent > 0 && summary.topPlatform && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-xs font-semibold text-blue-800 mb-1">📊 실제 현황</p>
              <p className="text-xs text-blue-700">
                상위 플랫폼: <strong>{summary.topPlatform}</strong> · 총 {summary.totalContent}개 콘텐츠 생성됨
                {summary.totalRevenue > 0 ? ` · 누적 수익: ${summary.totalRevenue.toLocaleString()}원` : ' · 수익 집계 대기 중 (YouTube 영상 공개 후 발생)'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* YouTube 업로드 현황 */}
      <div className="bg-white rounded-xl p-5 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-800">YouTube 업로드 현황</h3>
            <p className="text-xs text-gray-400 mt-0.5">자동 업로드된 Shorts 영상 목록 · 비공개 영상은 Studio에서 공개 전환 필요</p>
          </div>
          <a
            href="https://studio.youtube.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
          >
            YouTube Studio ↗
          </a>
        </div>
        <YouTubeUploads />
      </div>

      {/* 자동화 스케줄 현황 */}
      <div className="bg-white rounded-xl p-5 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">예정 게시 스케줄</h3>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>대기: <strong className="text-indigo-600">{autoStatus.pendingPosts}개</strong></span>
            <span>오늘 게시: <strong className="text-green-600">{autoStatus.todayPublished}개</strong></span>
          </div>
        </div>
        {autoStatus.nextScheduled.length > 0 ? (
          <div className="space-y-2">
            {autoStatus.nextScheduled.map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-gray-400 text-xs w-32">{new Date(s.scheduled_for).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium text-gray-600">{s.platform}</span>
                <span className="text-gray-700 truncate">{s.product_name}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">
            예정된 게시물이 없습니다.{' '}
            <Link href="/automation" className="text-indigo-500 underline">자동화를 실행</Link>하여 콘텐츠를 생성하세요.
          </p>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`text-sm font-semibold ${highlight ? 'text-yellow-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  )
}
