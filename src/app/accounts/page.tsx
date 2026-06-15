'use client'

import { useState, useEffect } from 'react'
import { Circle } from 'lucide-react'

const PLATFORM_ORDER = ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Threads', 'Naver']
const PLATFORM_COLORS: Record<string, string> = {
  YouTube: 'border-red-300 bg-red-50',
  Instagram: 'border-pink-300 bg-pink-50',
  TikTok: 'border-gray-700 bg-gray-900',
  Facebook: 'border-blue-300 bg-blue-50',
  Threads: 'border-gray-400 bg-gray-100',
  Naver: 'border-green-300 bg-green-50',
}
const PLATFORM_TEXT: Record<string, string> = {
  YouTube: 'text-red-700',
  Instagram: 'text-pink-700',
  TikTok: 'text-white',
  Facebook: 'text-blue-700',
  Threads: 'text-gray-700',
  Naver: 'text-green-700',
}

interface Account {
  id: number
  platform: string
  username: string
  followers: number
  total_revenue: number
  post_count: number
  status: string
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [filter, setFilter] = useState('전체')

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(setAccounts)
  }, [])

  const grouped = PLATFORM_ORDER.reduce<Record<string, Account[]>>((acc, p) => {
    acc[p] = accounts.filter(a => a.platform === p)
    return acc
  }, {})

  const totalFollowers = accounts.reduce((s, a) => s + a.followers, 0)
  const totalRevenue = accounts.reduce((s, a) => s + a.total_revenue, 0)
  const activeCount = accounts.filter(a => a.status === 'active').length

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-xl font-bold">계정 관리</h2>
        <p className="text-sm text-gray-500 mt-0.5">6개 플랫폼 × 30개 계정 운영 현황</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
          <p className="text-2xl font-bold text-gray-900">{activeCount}</p>
          <p className="text-xs text-gray-500 mt-1">활성 계정</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
          <p className="text-2xl font-bold text-gray-900">
            {totalFollowers >= 10000 ? `${(totalFollowers / 10000).toFixed(0)}만` : totalFollowers.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">총 팔로워</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
          <p className="text-2xl font-bold text-yellow-600">
            {totalRevenue >= 100000000 ? `${(totalRevenue / 100000000).toFixed(1)}억` : `${(totalRevenue / 10000).toFixed(0)}만원`}
          </p>
          <p className="text-xs text-gray-500 mt-1">총 수익</p>
        </div>
      </div>

      {/* Platform filter */}
      <div className="flex gap-2 flex-wrap">
        {['전체', ...PLATFORM_ORDER].map(p => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === p ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:border-gray-500'
            }`}
          >
            {p} {p !== '전체' && `(${grouped[p]?.length || 0})`}
          </button>
        ))}
      </div>

      {/* Account grids by platform */}
      {PLATFORM_ORDER.filter(p => filter === '전체' || filter === p).map(platform => {
        const pAccounts = grouped[platform] || []
        if (pAccounts.length === 0) return null
        return (
          <div key={platform}>
            <h3 className={`font-bold text-sm mb-3 flex items-center gap-2`}>
              <span>{platform}</span>
              <span className="text-gray-400 font-normal">{pAccounts.length}개 계정</span>
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {pAccounts.map(account => (
                <AccountCard key={account.id} account={account} platform={platform} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AccountCard({ account, platform }: { account: Account; platform: string }) {
  const colorCls = PLATFORM_COLORS[platform] || 'border-gray-300 bg-gray-50'
  const textCls = PLATFORM_TEXT[platform] || 'text-gray-700'

  return (
    <div className={`rounded-xl p-4 border ${colorCls} transition-shadow hover:shadow-sm`}>
      <div className="flex items-start justify-between mb-2">
        <span className={`text-xs font-bold ${textCls}`}>@{account.username}</span>
        <span className={`flex items-center gap-1 text-xs ${account.status === 'active' ? 'text-green-600' : 'text-gray-400'}`}>
          <Circle size={6} fill="currentColor" />
          {account.status === 'active' ? '활성' : '휴면'}
        </span>
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className={`opacity-70 ${textCls}`}>팔로워</span>
          <span className={`font-semibold ${textCls}`}>
            {account.followers >= 10000 ? `${(account.followers / 10000).toFixed(1)}만` : account.followers.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className={`opacity-70 ${textCls}`}>누적 수익</span>
          <span className={`font-bold ${textCls}`}>
            {(account.total_revenue / 10000).toFixed(0)}만원
          </span>
        </div>
        <div className="flex justify-between">
          <span className={`opacity-70 ${textCls}`}>게시물</span>
          <span className={`font-medium ${textCls}`}>{account.post_count}개</span>
        </div>
      </div>
    </div>
  )
}
