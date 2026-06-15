'use client'

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'

interface DailyData {
  date: string
  revenue: number
  views: number
}

interface PlatformData {
  platform: string
  revenue: number
  percentage: number
}

const COLORS = ['#EAB308', '#3B82F6', '#10B981', '#8B5CF6', '#F43F5E', '#F97316']

function shortDate(d: string) {
  const parts = d.split('-')
  return `${parts[1]}/${parts[2]}`
}

function fmtRevenue(n: unknown) {
  const num = Number(n)
  if (num >= 10000000) return `${(num / 10000000).toFixed(0)}천만`
  if (num >= 1000000) return `${(num / 1000000).toFixed(0)}백만`
  if (num >= 10000) return `${(num / 10000).toFixed(0)}만`
  return num.toLocaleString()
}

type PieProps = {
  platform?: string
  percentage?: number
  cx?: number
  cy?: number
  midAngle?: number
  innerRadius?: number
  outerRadius?: number
}

function PieLabel({ cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, platform, percentage }: PieProps) {
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 1.4
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)

  if (!percentage || percentage < 5) return null

  return (
    <text x={x} y={y} fill="#6B7280" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11}>
      {platform} {percentage}%
    </text>
  )
}

export function RevenueAreaChart({ data }: { data: DailyData[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#EAB308" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#EAB308" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={fmtRevenue} tick={{ fontSize: 11 }} width={55} />
        <Tooltip
          formatter={(v: unknown) => [`${Number(v).toLocaleString()}원`, '수익']}
          labelFormatter={(l) => shortDate(l as string)}
        />
        <Area type="monotone" dataKey="revenue" stroke="#EAB308" fill="url(#revGrad)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function PlatformPieChart({ data }: { data: PlatformData[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          dataKey="revenue"
          nameKey="platform"
          labelLine={false}
          label={(props) => {
            const d = data[props.index as number]
            return <PieLabel {...props} platform={d?.platform} percentage={d?.percentage} />
          }}
        >
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v: unknown) => `${Number(v).toLocaleString()}원`} />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function RevenueBarChart({ data }: { data: Array<{ name: string; revenue: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={fmtRevenue} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }}
          tickFormatter={(v: string) => v.length > 12 ? v.slice(0, 12) + '…' : v} />
        <Tooltip formatter={(v: unknown) => `${Number(v).toLocaleString()}원`} />
        <Bar dataKey="revenue" fill="#EAB308" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
