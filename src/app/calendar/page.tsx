'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'

const PLATFORM_COLORS: Record<string, string> = {
  YouTube: 'bg-red-400',
  Instagram: 'bg-pink-400',
  TikTok: 'bg-gray-800',
  Facebook: 'bg-blue-500',
  Threads: 'bg-gray-500',
  Naver: 'bg-green-500',
  Pinterest: 'bg-rose-500',
  Twitter: 'bg-sky-400',
  LINE: 'bg-green-400',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '예정',
  published: '게시됨',
  failed: '실패',
}

interface CalendarEvent {
  platform: string
  product_name: string
  status: string
  time: string
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']

export default function CalendarPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate())
  const [events, setEvents] = useState<Record<number, CalendarEvent[]>>({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const loadCalendar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/automation/calendar?year=${year}&month=${month}`)
      if (res.ok) {
        const data = await res.json()
        setEvents(data.events || {})
        setTotal(data.total || 0)
      }
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { loadCalendar() }, [loadCalendar])

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
    setSelectedDay(null)
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
    setSelectedDay(null)
  }

  const firstDow = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const todayDay = now.getFullYear() === year && now.getMonth() + 1 === month ? now.getDate() : -1

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const selectedEvents = selectedDay ? (events[selectedDay] || []) : []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">콘텐츠 캘린더</h1>
          <p className="text-gray-500 mt-1">{year}년 {MONTHS[month - 1]} · 예약 {total}건</p>
        </div>
        <button onClick={loadCalendar} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 캘린더 */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <ChevronLeft className="w-5 h-5 text-gray-500" />
            </button>
            <h2 className="text-lg font-bold text-gray-800">{year}년 {MONTHS[month - 1]}</h2>
            <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="grid grid-cols-7 mb-2">
            {DAYS.map((d, i) => (
              <div key={d} className={`text-center text-xs font-semibold py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />
              const dayEvents = events[day] || []
              const isToday = day === todayDay
              const isSelected = day === selectedDay
              const hasPublished = dayEvents.some(e => e.status === 'published')

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDay(day)}
                  className={`relative aspect-square flex flex-col items-center justify-start pt-1.5 rounded-lg text-sm transition-colors
                    ${isSelected ? 'bg-indigo-600 text-white' : isToday ? 'bg-indigo-50 border border-indigo-300' : 'hover:bg-gray-50'}
                    ${!isSelected && i % 7 === 0 ? 'text-red-400' : !isSelected && i % 7 === 6 ? 'text-blue-400' : ''}
                  `}
                >
                  <span className={`text-xs font-semibold leading-none ${isSelected ? 'text-white' : isToday ? 'text-indigo-700' : ''}`}>
                    {day}
                  </span>
                  {dayEvents.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-1 px-0.5 justify-center">
                      {dayEvents.slice(0, 3).map((e, j) => (
                        <div key={j} className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white opacity-80' : PLATFORM_COLORS[e.platform] || 'bg-gray-400'}`} />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className={`text-[8px] leading-none ${isSelected ? 'text-white' : 'text-gray-400'}`}>+{dayEvents.length - 3}</span>
                      )}
                    </div>
                  )}
                  {dayEvents.length > 0 && !isSelected && (
                    <div className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${hasPublished ? 'bg-green-400' : 'bg-amber-400'}`} />
                  )}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-gray-100">
            {Object.entries(PLATFORM_COLORS).slice(0, 6).map(([platform, color]) => (
              <div key={platform} className="flex items-center gap-1.5 text-xs text-gray-500">
                <div className={`w-2 h-2 rounded-full ${color}`} />
                {platform}
              </div>
            ))}
          </div>
        </div>

        {/* 선택일 상세 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 mb-3">
            {selectedDay ? `${month}월 ${selectedDay}일 예정` : '날짜를 선택하세요'}
          </h3>

          {selectedDay && (
            selectedEvents.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <p className="text-sm">예정된 콘텐츠 없음</p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedEvents.map((e, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-gray-50">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${PLATFORM_COLORS[e.platform] || 'bg-gray-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-gray-600">{e.platform}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          e.status === 'published' ? 'bg-green-100 text-green-700' :
                          e.status === 'failed' ? 'bg-red-100 text-red-600' :
                          'bg-amber-100 text-amber-700'
                        }`}>{STATUS_LABELS[e.status] || e.status}</span>
                      </div>
                      <p className="text-xs text-gray-700 truncate">{e.product_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{e.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          <div className="mt-4 pt-3 border-t border-gray-100 space-y-2">
            <p className="text-xs font-semibold text-gray-500">이번 달 현황</p>
            {[
              { label: '전체 예약', value: total, color: 'text-gray-700' },
              { label: '게시 완료', value: Object.values(events).flat().filter(e => e.status === 'published').length, color: 'text-green-600' },
              { label: '게시 예정', value: Object.values(events).flat().filter(e => e.status === 'pending').length, color: 'text-amber-600' },
              { label: '실패', value: Object.values(events).flat().filter(e => e.status === 'failed').length, color: 'text-red-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-gray-500">{label}</span>
                <span className={`font-semibold ${color}`}>{value}건</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
