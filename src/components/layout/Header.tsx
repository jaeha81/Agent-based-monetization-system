'use client'

import { usePathname } from 'next/navigation'
import { Zap } from 'lucide-react'
import MobileNav from './MobileNav'

const TITLES: Record<string, string> = {
  '/': '대시보드',
  '/agents': '에이전트 현황',
  '/automation': '자동화 제어',
  '/revenue-structure': '수익 구조',
  '/products': '제품 발굴 에이전트',
  '/content': '콘텐츠 생성 에이전트',
  '/accounts': '계정 관리',
  '/revenue': '수익 추적',
  '/calendar': '콘텐츠 캘린더',
  '/setup': 'API 설정',
}

export default function Header() {
  const pathname = usePathname()
  const title = TITLES[pathname] || '쇼츠 수익화'

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-2">
        <MobileNav />
        <div className="flex items-center gap-2 md:hidden">
          <Zap className="text-yellow-500" size={18} />
          <span className="font-bold text-sm">쇼츠 수익화</span>
        </div>
        <h1 className="hidden md:block font-semibold text-gray-800">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
          Mock 모드
        </span>
      </div>
    </header>
  )
}
