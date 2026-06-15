'use client'

const PLATFORM_COLORS: Record<string, string> = {
  YouTube: 'bg-red-100 text-red-700',
  Instagram: 'bg-pink-100 text-pink-700',
  TikTok: 'bg-black text-white',
  Facebook: 'bg-blue-100 text-blue-700',
  Threads: 'bg-gray-100 text-gray-700',
  Naver: 'bg-green-100 text-green-700',
}

interface ContentRow {
  id: number
  name: string
  platform: string
  views: number
  revenue: number
  status: string
}

export default function TopContent({ data }: { data: ContentRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2 font-medium">제품명</th>
            <th className="pb-2 font-medium">플랫폼</th>
            <th className="pb-2 font-medium text-right">조회수</th>
            <th className="pb-2 font-medium text-right">수익</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50">
              <td className="py-2 max-w-[180px] truncate">{row.name}</td>
              <td className="py-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLORS[row.platform] || 'bg-gray-100 text-gray-600'}`}>
                  {row.platform}
                </span>
              </td>
              <td className="py-2 text-right text-gray-600">
                {row.views >= 10000 ? `${(row.views / 10000).toFixed(0)}만` : row.views.toLocaleString()}
              </td>
              <td className="py-2 text-right font-semibold text-yellow-600">
                {row.revenue >= 10000 ? `${(row.revenue / 10000).toFixed(0)}만원` : `${row.revenue.toLocaleString()}원`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
