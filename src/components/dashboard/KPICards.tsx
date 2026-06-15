'use client'

import { TrendingUp, TrendingDown, DollarSign, Users, FileVideo, Target } from 'lucide-react'

interface KPICardsProps {
  totalRevenue: number
  monthlyRevenue: number
  activeAccounts: number
  totalContent: number
  growthRate: number
}

function fmt(n: number) {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`
  if (n >= 10000) return `${(n / 10000).toFixed(0)}만`
  return n.toLocaleString()
}

export default function KPICards({
  totalRevenue, monthlyRevenue, activeAccounts, totalContent, growthRate
}: KPICardsProps) {
  const cards = [
    {
      label: '누적 총 수익',
      value: `${fmt(totalRevenue)}원`,
      icon: DollarSign,
      color: 'bg-yellow-50 text-yellow-600',
      iconBg: 'bg-yellow-100',
      sub: '쿠팡 파트너스 + 광고',
    },
    {
      label: '이번 달 수익',
      value: `${fmt(monthlyRevenue)}원`,
      icon: Target,
      color: 'bg-blue-50 text-blue-600',
      iconBg: 'bg-blue-100',
      sub: growthRate >= 0 ? `전달 대비 +${growthRate}%` : `전달 대비 ${growthRate}%`,
      trend: growthRate,
    },
    {
      label: '활성 계정',
      value: `${activeAccounts}개`,
      icon: Users,
      color: 'bg-green-50 text-green-600',
      iconBg: 'bg-green-100',
      sub: '6개 플랫폼 운영 중',
    },
    {
      label: '총 콘텐츠',
      value: `${totalContent}개`,
      icon: FileVideo,
      color: 'bg-purple-50 text-purple-600',
      iconBg: 'bg-purple-100',
      sub: '숏츠 + 이미지 콘텐츠',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div key={card.label} className={`rounded-xl p-4 ${card.color} border border-opacity-20`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`p-2 rounded-lg ${card.iconBg}`}>
                <Icon size={18} />
              </div>
              {card.trend !== undefined && (
                <span className={`flex items-center text-xs font-medium ${card.trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {card.trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {Math.abs(card.trend)}%
                </span>
              )}
            </div>
            <p className="text-2xl font-bold mb-1">{card.value}</p>
            <p className="text-xs opacity-70">{card.label}</p>
            <p className="text-xs opacity-60 mt-1">{card.sub}</p>
          </div>
        )
      })}
    </div>
  )
}
