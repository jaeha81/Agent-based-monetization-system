'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Menu, X, Zap,
  LayoutDashboard, Search, FileVideo, Users,
  TrendingUp, Calendar, Bot, Settings, Cpu, BarChart2,
} from 'lucide-react'

const NAV = [
  { href: '/', label: '대시보드', icon: LayoutDashboard },
  { href: '/agents', label: '에이전트 현황', icon: Cpu, highlight: true },
  { href: '/automation', label: '자동화 제어', icon: Bot },
  { href: '/revenue-structure', label: '수익 구조', icon: BarChart2 },
  { href: '/products', label: '제품 발굴', icon: Search },
  { href: '/content', label: '콘텐츠 생성', icon: FileVideo },
  { href: '/accounts', label: '계정 관리', icon: Users },
  { href: '/revenue', label: '수익 추적', icon: TrendingUp },
  { href: '/calendar', label: '콘텐츠 캘린더', icon: Calendar },
  { href: '/setup', label: 'API 설정', icon: Settings },
]

export default function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // 라우트 이동 시 닫기
  useEffect(() => { setOpen(false) }, [pathname])

  // 열릴 때 body 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="md:hidden p-2 -ml-1 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors"
        aria-label="메뉴 열기"
      >
        <Menu size={22} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* 오버레이 */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* 드로어 */}
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-gray-900 text-white flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 py-5 border-b border-gray-700 shrink-0">
              <div className="flex items-center gap-2">
                <Zap className="text-yellow-400" size={22} />
                <div>
                  <p className="font-bold text-sm leading-tight">쇼츠 수익화</p>
                  <p className="text-xs text-gray-400">Agent Dashboard</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors"
                aria-label="메뉴 닫기"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="flex-1 py-3 overflow-y-auto">
              {NAV.map(item => {
                const Icon = item.icon
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                      active
                        ? 'bg-yellow-500 text-gray-900 font-semibold'
                        : item.highlight && !active
                        ? 'text-indigo-300 hover:bg-gray-800 font-medium'
                        : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    <Icon size={17} />
                    {item.label}
                    {item.highlight && !active && (
                      <span className="ml-auto text-[10px] bg-indigo-500 text-white px-1.5 py-0.5 rounded-full">
                        NEW
                      </span>
                    )}
                  </Link>
                )
              })}
            </nav>

            {/* Pipeline Visualization */}
            <div className="px-3 py-3 border-t border-gray-700 shrink-0">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2.5">시스템 파이프라인</p>
              <div>
                {[
                  { color: 'bg-violet-500', label: '트렌드 발굴', sub: 'Cron 02:00 KST' },
                  { color: 'bg-blue-400', label: '콘텐츠 생성', sub: 'Gemini 2.5 Flash' },
                  { color: 'bg-cyan-400', label: 'SEO + 클릭최적화', sub: '에이전트 체인' },
                  { color: 'bg-yellow-400', label: '스케줄 등록', sub: '6플랫폼 멀티포스팅' },
                  { color: 'bg-orange-400', label: '자동 발행', sub: 'Cron 2시간마다' },
                  { color: 'bg-green-400', label: '수익 동기화', sub: 'Cron 06:00 KST' },
                ].map((step, i, arr) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div className={`w-2.5 h-2.5 rounded-full ${step.color} mt-1`} />
                      {i < arr.length - 1 && <div className="w-px flex-1 bg-gray-600 my-0.5" style={{ minHeight: '12px' }} />}
                    </div>
                    <div className="pb-1.5">
                      <p className="text-[11px] text-gray-200 leading-tight font-medium">{step.label}</p>
                      <p className="text-[9px] text-gray-500 leading-tight mt-0.5">{step.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500 shrink-0">
              <p>Cron 4종 · 6플랫폼 · 글로벌 5개국</p>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
