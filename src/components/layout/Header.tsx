'use client'

import { usePathname } from 'next/navigation'
import { Zap } from 'lucide-react'

const TITLES: Record<string, string> = {
  '/': '대시보드',
  '/products': '제품 발굴 에이전트',
  '/content': '콘텐츠 생성 에이전트',
  '/accounts': '계정 관리',
  '/revenue': '수익 추적',
  '/calendar': '콘텐츠 캘린더',
}

export default function Header() {
  const pathname = usePathname()
  const title = TITLES[pathname] || '쇼츠 수익화'

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
      <div className="flex items-center gap-3 md:hidden">
        <Zap className="text-yellow-500" size={20} />
        <span className="font-bold text-sm">쇼츠 수익화</span>
      </div>
      <h1 className="hidden md:block font-semibold text-gray-800">{title}</h1>
      <div className="flex items-center gap-2">
        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
          Mock 모드 활성
        </span>
      </div>
    </header>
  )
}
