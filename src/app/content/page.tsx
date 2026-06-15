'use client'

import { useState, useEffect } from 'react'
import { Sparkles, Copy, Check, ChevronRight } from 'lucide-react'

const PLATFORMS = ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Threads', 'Naver']

const PLATFORM_COLORS: Record<string, string> = {
  YouTube: 'bg-red-500',
  Instagram: 'bg-gradient-to-r from-pink-500 to-purple-500',
  TikTok: 'bg-black',
  Facebook: 'bg-blue-600',
  Threads: 'bg-gray-800',
  Naver: 'bg-green-600',
}

interface Product {
  id: number
  name: string
  category: string
}

interface ContentBatch {
  hook: string
  script: string
  image_prompt: string
}

export default function ContentPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(false)
  const [agentText, setAgentText] = useState('')
  const [contents, setContents] = useState<Record<string, ContentBatch>>({})
  const [activePlatform, setActivePlatform] = useState('YouTube')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then((data: Product[]) => {
      setProducts(data)
      if (data.length > 0) setSelectedProduct(data[0])
    })
  }, [])

  async function handleGenerate() {
    if (!selectedProduct) return
    setLoading(true)
    setContents({})
    setAgentText('')

    try {
      const res = await fetch('/api/agents/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          category: selectedProduct.category,
        }),
      })
      const data = await res.json()
      setAgentText(data.text || '')
      setContents(data.contents || {})
    } finally {
      setLoading(false)
    }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  const current = contents[activePlatform]

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-xl font-bold">콘텐츠 생성 에이전트</h2>
        <p className="text-sm text-gray-500 mt-0.5">1개 제품 → 6개 플랫폼 콘텐츠 자동 생성</p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl p-5 border border-gray-200">
        <div className="flex gap-3">
          <select
            className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
            value={selectedProduct?.id || ''}
            onChange={e => {
              const p = products.find(x => x.id === Number(e.target.value))
              if (p) setSelectedProduct(p)
            }}
          >
            {products.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.category})</option>
            ))}
          </select>
          <button
            onClick={handleGenerate}
            disabled={loading || !selectedProduct}
            className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-200 text-gray-900 font-semibold rounded-lg text-sm transition-colors whitespace-nowrap"
          >
            <Sparkles size={15} />
            {loading ? 'AI 생성 중...' : '6플랫폼 생성'}
          </button>
        </div>

        {selectedProduct && (
          <p className="mt-2 text-xs text-gray-500">
            선택: <strong>{selectedProduct.name}</strong> — 카테고리: {selectedProduct.category}
          </p>
        )}
      </div>

      {/* Agent thinking */}
      {(loading || agentText) && (
        <div className="bg-gray-900 rounded-xl p-4 text-xs font-mono">
          <div className="flex items-center gap-2 mb-2 text-green-400">
            <Sparkles size={12} />
            <span className="font-bold">콘텐츠 에이전트</span>
            {loading && <span className="text-yellow-400 animate-pulse">●</span>}
          </div>
          {agentText ? (
            <p className="text-green-300 whitespace-pre-wrap leading-relaxed">{agentText}</p>
          ) : (
            <p className="text-gray-400 animate-pulse">6개 플랫폼 콘텐츠 생성 중...</p>
          )}
        </div>
      )}

      {/* Platform tabs + content */}
      {Object.keys(contents).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Platform tabs */}
          <div className="flex overflow-x-auto border-b border-gray-200">
            {PLATFORMS.map(platform => (
              <button
                key={platform}
                onClick={() => setActivePlatform(platform)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                  activePlatform === platform
                    ? 'border-yellow-500 text-yellow-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${PLATFORM_COLORS[platform]}`} />
                {platform}
              </button>
            ))}
          </div>

          {current && (
            <div className="p-5 space-y-5">
              {/* Hook */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">훅 (Hook) — 첫 3초</label>
                  <button
                    onClick={() => copyText(current.hook, 'hook')}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
                  >
                    {copied === 'hook' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                    복사
                  </button>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-sm font-semibold text-gray-900">{current.hook}</p>
                </div>
              </div>

              {/* Script */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">스크립트 — 15초 본문</label>
                  <button
                    onClick={() => copyText(current.script, 'script')}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
                  >
                    {copied === 'script' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                    복사
                  </button>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{current.script}</p>
                </div>
              </div>

              {/* Image prompts */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">이미지 프롬프트 (AI 생성용)</label>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs text-blue-800 font-mono leading-relaxed">{current.image_prompt}</p>
                  <button
                    onClick={() => copyText(current.image_prompt, 'img')}
                    className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    {copied === 'img' ? <Check size={11} /> : <Copy size={11} />}
                    프롬프트 복사
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button className="flex items-center gap-1.5 text-sm px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors">
                  <Check size={14} />
                  초안 저장
                </button>
                <button className="flex items-center gap-1.5 text-sm px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                  <ChevronRight size={14} />
                  발행 예약
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {Object.keys(contents).length === 0 && !loading && (
        <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
          <Sparkles size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">제품을 선택하고 AI 생성 버튼을 누르면</p>
          <p className="text-gray-400 text-xs mt-1">6개 플랫폼용 콘텐츠가 자동으로 만들어집니다</p>
        </div>
      )}
    </div>
  )
}
