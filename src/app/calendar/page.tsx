'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const PLATFORM_COLORS: Record<string, string> = {
  YouTube: 'bg-red-400',
  Instagram: 'bg-pink-400',
  TikTok: 'bg-gray-800',
  Facebook: 'bg-blue-500',
  Threads: 'bg-gray-500',
  Naver: 'bg-green-500',
}

function generateMockCalendarData(year: number, month: number) {
  const events: Record<number, Array<{ platform: string; title: string; status: string }>> = {}
  const platforms = ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Threads', 'Naver']
  const titles = [
    '다이소 마카 리뷰', '나이키 신발 추천', 'MAC 블러셔 하울',
    '닌텐도 스위치 추천', '셀럽 쇼핑 리스트', '다이어트 제품 Top5',
  ]

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let i = 0; i < 40; i++) {
    const day = Math.floor(Math.random() * daysInMonth) + 1
    if (!events[day]) events[day] = []
    if (events[day].length < 3) {
      events[day].push({
        platform: platforms[Math.floor(Math.random() * platforms.length)],
        title: titles[Math.floor(Math.random() * titles.length)],
        status: Math.random() > 0.4 ? 'posted' : 'scheduled',
      })
    }
  }
  return events
}

export default function CalendarPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate())

  const events = generateMockCalendarData(year, month)

  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
    setSelectedDay(null)
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
    setSelectedDay(null)
  }

  const MONTH_KO = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
  const DOW_KO = ['일', '월', '화', '수', '목', '금', '토']

  const totalScheduled = Object.values(events).flat().filter(e => e.status === 'scheduled').length
  const totalPosted = Object.values(events).flat().filter(e => e.status === 'posted').length

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-xl font-bold">콘텐츠 캘린더</h2>
        <p className="text-sm text-gray-500 mt-0.5">이번 달 업로드 예정 및 완료 현황</p>
      </div>

      <div className="flex gap-4">
        <div className="bg-white rounded-xl px-4 py-3 border border-gray-200 text-center">
          <p className="text-2xl font-bold text-green-600">{totalPosted}</p>
          <p className="text-xs text-gray-500">완료</p>
        </div>
        <div className="bg-white rounded-xl px-4 py-3 border border-gray-200 text-center">
          <p className="text-2xl font-bold text-blue-600">{totalScheduled}</p>
          <p className="text-xs text-gray-500">예약됨</p>
        </div>
        <div className="bg-white rounded-xl px-4 py-3 border border-gray-200 text-center">
          <p className="text-2xl font-bold text-gray-700">{totalPosted + totalScheduled}</p>
          <p className="text-xs text-gray-500">이번 달 총계</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Calendar */}
        <div className="md:col-span-2 bg-white rounded-xl p-5 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <ChevronLeft size={18} />
            </button>
            <h3 className="font-bold text-gray-900">{year}년 {MONTH_KO[month]}</h3>
            <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {DOW_KO.map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDow }, (_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const dayEvents = events[day] || []
              const isToday = day === now.getDate() && month === now.getMonth() && year === now.getFullYear()
              const isSelected = day === selectedDay

              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                  className={`relative min-h-[52px] p-1.5 rounded-lg text-left border transition-all ${
                    isSelected ? 'border-yellow-400 bg-yellow-50' :
                    isToday ? 'border-gray-900 bg-gray-50' :
                    'border-transparent hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className={`text-xs font-medium block mb-1 ${isToday ? 'text-gray-900 font-bold' : 'text-gray-600'}`}>
                    {day}
                  </span>
                  <div className="flex flex-wrap gap-0.5">
                    {dayEvents.slice(0, 3).map((e, ei) => (
                      <span
                        key={ei}
                        className={`w-1.5 h-1.5 rounded-full ${PLATFORM_COLORS[e.platform] || 'bg-gray-400'}`}
                      />
                    ))}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="flex gap-3 mt-4 pt-3 border-t border-gray-100 flex-wrap">
            {Object.entries(PLATFORM_COLORS).map(([p, c]) => (
              <div key={p} className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className={`w-2 h-2 rounded-full ${c}`} />
                {p}
              </div>
            ))}
          </div>
        </div>

        {/* Day detail */}
        <div className="bg-white rounded-xl p-5 border border-gray-200">
          <h3 className="font-semibold text-gray-800 mb-3">
            {selectedDay ? `${MONTH_KO[month]} ${selectedDay}일` : '날짜를 선택하세요'}
          </h3>

          {selectedDay && events[selectedDay] ? (
            <div className="space-y-3">
              {events[selectedDay].map((e, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg">
                  <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${PLATFORM_COLORS[e.platform]}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{e.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-500">{e.platform}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        e.status === 'posted' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {e.status === 'posted' ? '완료' : '예약됨'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : selectedDay ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-400">이날 콘텐츠 없음</p>
              <button className="mt-3 text-xs text-yellow-600 hover:underline">+ 콘텐츠 예약</button>
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">캘린더에서 날짜를 클릭하세요</p>
          )}
        </div>
      </div>
    </div>
  )
}
