'use client'

import { useState, useEffect } from 'react'

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const accepted = localStorage.getItem('cookie_consent')
    if (!accepted) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem('cookie_consent', '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-gray-900 text-white shadow-lg">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-gray-300 flex-1">
          이 사이트는 서비스 개선 및 맞춤형 광고를 위해 쿠키와 유사 기술을 사용합니다.
          EU/EEA 방문자의 경우 GDPR에 따라 동의가 필요합니다.
          자세한 내용은{' '}
          <a href="#" className="underline text-indigo-400">개인정보 처리방침</a>을 참고하세요.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setVisible(false)}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-600 rounded-lg transition-colors"
          >
            거부
          </button>
          <button
            onClick={accept}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
          >
            동의
          </button>
        </div>
      </div>
    </div>
  )
}
