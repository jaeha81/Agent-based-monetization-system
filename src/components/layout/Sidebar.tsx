'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Search,
  FileVideo,
  Users,
  TrendingUp,
  Calendar,
  Zap,
} from 'lucide-react'

const NAV = [
  { href: '/', label: '대시보드', icon: LayoutDashboard },
  { href: '/products', label: '제품 발굴', icon: Search },
  { href: '/content', label: '콘텐츠 생성', icon: FileVideo },
  { href: '/accounts', label: '계정 관리', icon: Users },
  { href: '/revenue', label: '수익 추적', icon: TrendingUp },
  { href: '/calendar', label: '콘텐츠 캘린더', icon: Calendar },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden md:flex flex-col w-56 min-h-screen bg-gray-900 text-white">
      <div className="flex items-center gap-2 px-4 py-5 border-b border-gray-700">
        <Zap className="text-yellow-400" size={22} />
        <div>
          <p className="font-bold text-sm leading-tight">쇼츠 수익화</p>
          <p className="text-xs text-gray-400">Agent Dashboard</p>
        </div>
      </div>

      <nav className="flex-1 py-4">
        {NAV.map(item => {
          const Icon = item.icon
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? 'bg-yellow-500 text-gray-900 font-semibold'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <Icon size={17} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
        <p>김정민 전략 기반</p>
        <p>6플랫폼 × 30계정</p>
      </div>
    </aside>
  )
}
