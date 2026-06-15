'use client'

import { useState, useEffect } from 'react'
import { RevenueBarChart } from '@/components/dashboard/RevenueChart'

type Period = '오늘' | '이번 주' | '이번 달' | '전체'

interface RevenueSummary {
  totalRevenue: number
  monthlyRevenue: number
  weeklyRevenue: number
  todayRevenue: number
  topContent: Array<{
    id: number
    name: string
    platform: string
    views: number
    revenue: number
    status: string
  }>
  platformData: Array<{ platform: string; revenue: number; percentage: number }>
}

const PLATFORM_BADGE: Record<string, string> = {
  YouTube: 'bg-red-100 text-red-700',
  Instagram: 'bg-pink-100 text-pink-700',
  TikTok: 'bg-gray-800 text-white',
  Facebook: 'bg-blue-100 text-blue-700',
  Threads: 'bg-gray-100 text-gray-700',
  Naver: 'bg-green-100 text-green-700',
}

export default function RevenuePage() {
  const [period, setPeriod] = useState<Period>('이번 달')
  const [data, setData] = useState<RevenueSummary | null>(null)

  useEffect(() => {
    fetch('/api/revenue').then(r => r.json()).then(setData)
  }, [])

  if (!data) {
    return <div className="flex items-center justify-center h-64 text-gray-400">로딩 중...</div>
  }

  const periodRevenue: Record<Period, number> = {
    '오늘': data.todayRevenue,
    '이번 주': data.weeklyRevenue,
    '이번 달': data.monthlyRevenue,
    '전체': data.totalRevenue,
  }

  const barData = data.topContent.map(c => ({
    name: c.name,
    revenue: c.revenue,
  }))

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-xl font-bold">수익 추적</h2>
        <p className="text-sm text-gray-500 mt-0.5">쿠팡 파트너스 + YouTube 광고 수익 현황</p>
      </div>

      {/* Period filter */}
      <div className="flex gap-2">
        {(['오늘', '이번 주', '이번 달', '전체'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`text-sm px-4 py-2 rounded-lg border transition-colors ${
              period === p ? 'bg-yellow-500 text-gray-900 border-yellow-500 font-semibold' : 'border-gray-300 text-gray-600 hover:border-gray-500'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Revenue KPI */}
      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <p className="text-sm text-gray-500">{period} 총 수익</p>
        <p className="text-4xl font-bold text-yellow-600 mt-1">
          {periodRevenue[period] >= 100000000
            ? `${(periodRevenue[period] / 100000000).toFixed(2)}억원`
            : `${(periodRevenue[period] / 10000).toFixed(0)}만원`}
        </p>
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
          {data.platformData.map(p => (
            <div key={p.platform} className="text-center">
              <p className="text-xs text-gray-500">{p.platform}</p>
              <p className="font-semibold text-sm mt-1">{p.percentage}%</p>
              <p className="text-xs text-gray-400">{(p.revenue / 10000).toFixed(0)}만원</p>
            </div>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="bg-white rounded-xl p-5 border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-4">콘텐츠별 수익 Top 10</h3>
        <RevenueBarChart data={barData} />
      </div>

      {/* Detailed table */}
      <div className="bg-white rounded-xl p-5 border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-4">상세 수익 내역</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b pb-2">
                <th className="pb-3 font-medium">제품명</th>
                <th className="pb-3 font-medium">플랫폼</th>
                <th className="pb-3 font-medium text-right">조회수</th>
                <th className="pb-3 font-medium text-right">수익</th>
                <th className="pb-3 font-medium text-right">CPM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.topContent.map(row => {
                const cpm = row.views > 0 ? ((row.revenue / row.views) * 1000).toFixed(0) : '0'
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="py-3 max-w-[200px]">
                      <p className="truncate font-medium text-gray-900">{row.name}</p>
                    </td>
                    <td className="py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_BADGE[row.platform] || 'bg-gray-100 text-gray-600'}`}>
                        {row.platform}
                      </span>
                    </td>
                    <td className="py-3 text-right text-gray-600">
                      {row.views >= 10000000
                        ? `${(row.views / 10000000).toFixed(1)}천만`
                        : row.views >= 10000
                        ? `${(row.views / 10000).toFixed(0)}만`
                        : row.views.toLocaleString()}
                    </td>
                    <td className="py-3 text-right font-semibold text-yellow-600">
                      {row.revenue >= 10000
                        ? `${(row.revenue / 10000).toFixed(0)}만원`
                        : `${row.revenue.toLocaleString()}원`}
                    </td>
                    <td className="py-3 text-right text-xs text-gray-500">{cpm}원</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
