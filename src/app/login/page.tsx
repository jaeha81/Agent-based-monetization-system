'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        router.push('/')
        router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || '비밀번호가 틀렸습니다.')
      }
    } catch {
      setError('오류가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl mb-2">📊</div>
          <h1 className="text-xl font-bold text-gray-900">쇼츠 수익화 대시보드</h1>
          <p className="text-sm text-gray-500 mt-1">비밀번호를 입력하세요</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoFocus
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '확인 중...' : '입력'}
          </button>
        </form>
      </div>
    </div>
  )
}
