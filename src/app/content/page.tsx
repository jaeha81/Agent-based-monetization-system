'use client'

import { useState, useEffect, useCallback } from 'react'
import { Sparkles, Copy, Check, Upload, Pencil, Trash2, RefreshCw, Send, List } from 'lucide-react'

const PLATFORM_COLORS: Record<string, string> = {
  YouTube: 'bg-red-500', Instagram: 'bg-pink-500', TikTok: 'bg-gray-800',
  Facebook: 'bg-blue-600', Threads: 'bg-gray-700', Naver: 'bg-green-600',
  Pinterest: 'bg-rose-500', Twitter: 'bg-sky-400', LINE: 'bg-green-400',
}

interface Product { id: number; name: string; category: string }
interface ContentRow {
  id: number; product_id: number; platform: string
  hook: string | null; script: string | null; image_prompt: string | null
  status: string; views: number; revenue: number
  product_name: string; category: string; language: string | null
}

type Tab = 'generate' | 'library'

export default function ContentPage() {
  const [tab, setTab] = useState<Tab>('generate')
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [generating, setGenerating] = useState(false)
  const [agentText, setAgentText] = useState('')
  const [copied, setCopied] = useState('')

  // Library state
  const [library, setLibrary] = useState<ContentRow[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editFields, setEditFields] = useState<{ hook: string; script: string }>({ hook: '', script: '' })
  const [publishing, setPublishing] = useState<number | null>(null)
  const [publishResult, setPublishResult] = useState<Record<number, string>>({})

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true)
    try {
      const res = await fetch('/api/content?limit=50')
      if (res.ok) setLibrary(await res.json())
    } finally { setLibraryLoading(false) }
  }, [])

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then((data: Product[]) => {
      setProducts(data)
      if (data.length > 0) setSelectedProduct(data[0])
    })
    loadLibrary()
  }, [loadLibrary])

  async function handleGenerate() {
    if (!selectedProduct) return
    setGenerating(true)
    setAgentText('')
    try {
      const res = await fetch('/api/agents/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: selectedProduct.id, productName: selectedProduct.name, category: selectedProduct.category }),
      })
      const data = await res.json()
      setAgentText(data.text || '생성 완료')
      await loadLibrary()
      setTab('library')
    } finally { setGenerating(false) }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  function startEdit(row: ContentRow) {
    setEditingId(row.id)
    setEditFields({ hook: row.hook || '', script: row.script || '' })
  }

  async function saveEdit(id: number) {
    await fetch(`/api/content/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editFields),
    })
    setEditingId(null)
    loadLibrary()
  }

  async function deleteContent(id: number) {
    if (!confirm('삭제하시겠습니까?')) return
    await fetch(`/api/content/${id}`, { method: 'DELETE' })
    loadLibrary()
  }

  async function instantPublish(row: ContentRow) {
    setPublishing(row.id)
    setPublishResult(r => ({ ...r, [row.id]: '' }))
    try {
      const res = await fetch('/api/publish/instant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentId: row.id }),
      })
      const data = await res.json()
      if (data.ok) {
        setPublishResult(r => ({ ...r, [row.id]: data.url ? `✓ ${data.url}` : '✓ 게시 완료' }))
        loadLibrary()
      } else {
        setPublishResult(r => ({ ...r, [row.id]: `✕ ${data.error}` }))
      }
    } catch {
      setPublishResult(r => ({ ...r, [row.id]: '✕ 네트워크 오류' }))
    } finally { setPublishing(null) }
  }

  const grouped = library.reduce<Record<string, ContentRow[]>>((acc, row) => {
    const key = row.product_name
    if (!acc[key]) acc[key] = []
    acc[key].push(row)
    return acc
  }, {})

  const STATUS_COLOR: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    scheduled: 'bg-blue-100 text-blue-700',
    posted: 'bg-green-100 text-green-700',
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">콘텐츠 관리</h2>
          <p className="text-sm text-gray-500 mt-0.5">AI 생성 → 편집 → 즉시 게시</p>
        </div>
        <div className="flex p-1 bg-gray-100 rounded-lg gap-1">
          <button onClick={() => setTab('generate')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === 'generate' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            <Sparkles className="w-3.5 h-3.5" /> 생성
          </button>
          <button onClick={() => { setTab('library'); loadLibrary() }} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === 'library' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            <List className="w-3.5 h-3.5" /> 라이브러리 ({library.length})
          </button>
        </div>
      </div>

      {/* ── 생성 탭 ── */}
      {tab === 'generate' && (
        <div className="space-y-4">
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
                {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.category})</option>)}
              </select>
              <button
                onClick={handleGenerate}
                disabled={generating || !selectedProduct}
                className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-200 text-gray-900 font-semibold rounded-lg text-sm transition-colors whitespace-nowrap"
              >
                <Sparkles size={15} />
                {generating ? 'AI 생성 중...' : '6플랫폼 생성'}
              </button>
            </div>
            {selectedProduct && (
              <p className="mt-2 text-xs text-gray-500">
                선택: <strong>{selectedProduct.name}</strong> · {selectedProduct.category}
              </p>
            )}
          </div>

          {(generating || agentText) && (
            <div className="bg-gray-900 rounded-xl p-4 text-xs font-mono">
              <div className="flex items-center gap-2 mb-2 text-green-400">
                <Sparkles size={12} />
                <span className="font-bold">콘텐츠 에이전트</span>
                {generating && <span className="text-yellow-400 animate-pulse">●</span>}
              </div>
              {agentText
                ? <p className="text-green-300 whitespace-pre-wrap leading-relaxed">{agentText}</p>
                : <p className="text-gray-400 animate-pulse">6개 플랫폼 콘텐츠 생성 중 (Gemini 2.5 Flash)...</p>}
            </div>
          )}
        </div>
      )}

      {/* ── 라이브러리 탭 ── */}
      {tab === 'library' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={loadLibrary} disabled={libraryLoading} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 border rounded-lg px-3 py-1.5 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${libraryLoading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>

          {Object.entries(grouped).map(([productName, rows]) => (
            <div key={productName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="font-semibold text-gray-800 text-sm">{productName}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{rows.length}개 플랫폼</p>
              </div>
              <div className="divide-y divide-gray-100">
                {rows.map(row => (
                  <div key={row.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${PLATFORM_COLORS[row.platform] || 'bg-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-700">{row.platform}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[row.status] || 'bg-gray-100 text-gray-500'}`}>
                            {row.status === 'draft' ? '초안' : row.status === 'scheduled' ? '예약됨' : row.status === 'posted' ? '게시됨' : row.status}
                          </span>
                          {row.language && row.language !== 'ko' && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{row.language}</span>
                          )}
                          {row.revenue > 0 && (
                            <span className="text-xs text-green-600 font-medium">₩{row.revenue.toLocaleString()}</span>
                          )}
                        </div>

                        {editingId === row.id ? (
                          <div className="space-y-2">
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">훅</label>
                              <input
                                value={editFields.hook}
                                onChange={e => setEditFields(f => ({ ...f, hook: e.target.value }))}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">스크립트</label>
                              <textarea
                                value={editFields.script}
                                onChange={e => setEditFields(f => ({ ...f, script: e.target.value }))}
                                rows={3}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => saveEdit(row.id)} className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700">저장</button>
                              <button onClick={() => setEditingId(null)} className="px-3 py-1.5 border text-xs rounded-lg hover:bg-gray-50">취소</button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {row.hook && (
                              <p className="text-sm font-medium text-gray-900 bg-yellow-50 px-2 py-1 rounded">
                                {row.hook}
                              </p>
                            )}
                            {row.script && (
                              <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{row.script}</p>
                            )}
                          </div>
                        )}

                        {publishResult[row.id] && (
                          <p className={`text-xs mt-2 ${publishResult[row.id].startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                            {publishResult[row.id]}
                          </p>
                        )}
                      </div>

                      {editingId !== row.id && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => copyText(row.hook || '', `hook-${row.id}`)} title="훅 복사" className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                            {copied === `hook-${row.id}` ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => startEdit(row)} title="편집" className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {row.status !== 'posted' && (
                            <button
                              onClick={() => instantPublish(row)}
                              disabled={publishing === row.id}
                              title="즉시 게시"
                              className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                            >
                              {publishing === row.id
                                ? <Upload className="w-3.5 h-3.5 animate-pulse" />
                                : row.platform === 'YouTube' ? <Send className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          <button onClick={() => deleteContent(row.id)} title="삭제" className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {library.length === 0 && !libraryLoading && (
            <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
              <List className="w-10 h-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm">생성된 콘텐츠가 없습니다</p>
              <p className="text-gray-400 text-xs mt-1">생성 탭에서 콘텐츠를 만들거나 자동화를 실행하세요</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
