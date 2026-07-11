'use client'

import { useState, useEffect } from 'react'
import { Search, Sparkles, TrendingUp, Star } from 'lucide-react'

const CATEGORIES = ['전체', '다이소', '뷰티', '유아', '전자기기', '스포츠', '패션']

const CATEGORY_COLORS: Record<string, string> = {
  '다이소': 'bg-red-100 text-red-700',
  '뷰티': 'bg-pink-100 text-pink-700',
  '유아': 'bg-blue-100 text-blue-700',
  '전자기기': 'bg-purple-100 text-purple-700',
  '스포츠': 'bg-green-100 text-green-700',
  '패션': 'bg-orange-100 text-orange-700',
}

interface Product {
  id: number
  name: string
  category: string
  viral_score: number
  estimated_revenue: number
  commission_rate: number
  performance_score: number
  total_views: number
  total_engaged_views: number
  total_clicks: number
  avg_retention: number
  actual_revenue: number
  total_cost: number
  net_profit: number
  profit_score: number
  selection_score: number
  decision_action: string
  market_trend_score: number
  revenue_data_complete_through: string | null
}

export default function ProductsPage() {
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('전체')
  const [loading, setLoading] = useState(false)
  const [agentOutput, setAgentOutput] = useState('')
  const [toolCalls, setToolCalls] = useState<string[]>([])
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    fetch('/api/products')
      .then(r => r.json())
      .then(setProducts)
  }, [])

  async function handleSearch() {
    if (!keyword.trim()) return
    setLoading(true)
    setAgentOutput('')
    setToolCalls([])

    try {
      const res = await fetch('/api/agents/trend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, category }),
      })
      const data = await res.json()
      setAgentOutput(data.text || '')
      setToolCalls(data.toolCalls || [])

      // Refresh products list
      const refreshed = await fetch('/api/products').then(r => r.json())
      setProducts(refreshed)
    } finally {
      setLoading(false)
    }
  }

  const filtered = category === '전체' ? products : products.filter(p => p.category === category)

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-xl font-bold">제품 발굴 에이전트</h2>
        <p className="text-sm text-gray-500 mt-0.5">실제 시청 유지율·조회수·상품 클릭을 학습해 수익 가능성이 높은 제품을 우선 발굴합니다</p>
      </div>

      {/* Search Form */}
      <div className="bg-white rounded-xl p-5 border border-gray-200">
        <div className="flex gap-3 mb-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              placeholder="키워드 입력 (예: 다이소 신상, 셀럽 추천, 게임 굿즈...)"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !keyword.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-200 text-gray-900 font-semibold rounded-lg text-sm transition-colors"
          >
            <Sparkles size={15} />
            {loading ? 'AI 분석 중...' : 'AI 탐색'}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                category === c ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:border-gray-500'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Agent Output */}
      {(loading || agentOutput) && (
        <div className="bg-gray-900 rounded-xl p-5 text-sm font-mono">
          <div className="flex items-center gap-2 mb-3 text-green-400">
            <Sparkles size={14} />
            <span className="text-xs font-bold">AI 에이전트 실행 중</span>
            {loading && <span className="text-yellow-400 animate-pulse">●</span>}
          </div>

          {toolCalls.length > 0 && (
            <div className="mb-3 space-y-1">
              {toolCalls.map((tc, i) => (
                <div key={i} className="text-blue-400 text-xs">
                  <span className="text-gray-500">→ </span>{tc}
                </div>
              ))}
            </div>
          )}

          {agentOutput && (
            <div className="text-green-300 text-xs whitespace-pre-wrap leading-relaxed border-t border-gray-700 pt-3">
              {agentOutput}
            </div>
          )}

          {loading && !agentOutput && (
            <div className="text-gray-400 text-xs animate-pulse">
              트렌드 데이터 분석 중... 잠시만 기다려 주세요
            </div>
          )}
        </div>
      )}

      {/* Products Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">
            발굴된 제품 <span className="text-yellow-600">{filtered.length}개</span>
          </h3>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ProductCard({ product }: { product: Product }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-200 hover:border-yellow-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between mb-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[product.category] || 'bg-gray-100 text-gray-600'}`}>
          {product.category}
        </span>
        <div className="flex items-center gap-1 text-gray-400">
          <Star size={12} />
          <span className="text-xs font-medium">수수료 {product.commission_rate}%</span>
        </div>
      </div>

      <h4 className="font-semibold text-sm text-gray-900 mb-3 leading-tight">
        {product.name}
      </h4>

      <div className="space-y-1.5 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>수수료율</span>
          <span className="font-medium text-yellow-600">{product.commission_rate}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span>성과 점수</span>
          <span className="font-medium text-blue-600">{(product.performance_score || 0).toFixed(1)}점</span>
        </div>
        <div className="flex items-center justify-between">
          <span>조회 / 참여시청 / 클릭</span>
          <span className="font-medium text-gray-700">{(product.total_views || 0).toLocaleString()} / {(product.total_engaged_views || 0).toLocaleString()} / {(product.total_clicks || 0).toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>자가루프 판단</span>
          <span className="font-medium text-violet-600">{product.decision_action || 'learn'} · {(product.selection_score || 0).toFixed(1)}점</span>
        </div>
        <div className="flex items-center justify-between">
          <span>시장 연관점수</span>
          <span className="font-medium text-orange-600">{(product.market_trend_score || 0).toFixed(1)}점</span>
        </div>
        <div className="flex items-center justify-between">
          <span>평균 시청 유지율</span>
          <span className="font-medium text-gray-700">{(product.avg_retention || 0).toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span>실제 순이익</span>
          <span className={`font-semibold ${(product.net_profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{(product.net_profit || 0).toLocaleString()}원</span>
        </div>
        <div className="flex items-center justify-between">
          <span>수익 / 제작비</span>
          <span className="font-medium text-gray-700">{(product.actual_revenue || 0).toLocaleString()} / {(product.total_cost || 0).toLocaleString()}원</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <TrendingUp size={11} />
          <span>성과 80% 활용 · 신규 상품 20% 탐색</span>
        </div>
      </div>
    </div>
  )
}
