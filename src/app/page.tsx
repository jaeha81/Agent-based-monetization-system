import { getRevenueSummary } from '@/lib/agents/revenue-agent'
import KPICards from '@/components/dashboard/KPICards'
import { RevenueAreaChart, PlatformPieChart } from '@/components/dashboard/RevenueChart'
import TopContent from '@/components/dashboard/TopContent'

export const dynamic = 'force-dynamic'

export default function HomePage() {
  const summary = getRevenueSummary()

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h2 className="text-xl font-bold text-gray-900">수익화 현황</h2>
        <p className="text-sm text-gray-500 mt-0.5">쇼핑숏츠 에이전트 시스템 — 김정민 전략 기반</p>
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

          <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
            <p className="text-xs font-semibold text-yellow-800 mb-1">💡 에이전트 인사이트</p>
            <p className="text-xs text-yellow-700">
              뷰티 카테고리 셀럽 협찬 제품 비중을 늘리면 수익이 약 30% 증가할 것으로 예측됩니다.
              제품 발굴 에이전트를 실행해 보세요.
            </p>
          </div>
        </div>
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
