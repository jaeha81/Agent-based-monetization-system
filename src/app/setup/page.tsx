'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Circle, ExternalLink, Key, Video, ShoppingCart, Zap } from 'lucide-react'

interface EnvStatus {
  ANTHROPIC_API_KEY: boolean
  COUPANG_ACCESS_KEY: boolean
  COUPANG_SECRET_KEY: boolean
  YOUTUBE_CLIENT_ID: boolean
  YOUTUBE_REFRESH_TOKEN: boolean
  CRON_SECRET: boolean
}

const STEPS = [
  {
    id: 'anthropic',
    icon: Zap,
    title: 'Claude AI API',
    color: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
    required: true,
    envKey: 'ANTHROPIC_API_KEY' as keyof EnvStatus,
    description: '콘텐츠 자동 생성에 필요합니다.',
    steps: [
      { text: 'console.anthropic.com 접속', url: 'https://console.anthropic.com' },
      { text: 'API Keys → Create Key' },
      { text: '.env.local에 ANTHROPIC_API_KEY=sk-ant-... 추가' },
    ],
  },
  {
    id: 'coupang',
    icon: ShoppingCart,
    title: '쿠팡 파트너스',
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    required: true,
    envKey: 'COUPANG_ACCESS_KEY' as keyof EnvStatus,
    description: '제품 발굴 + 수익 어필리에이트 링크 생성',
    steps: [
      { text: 'partners.coupang.com 파트너 가입', url: 'https://partners.coupang.com' },
      { text: '마이페이지 → API 키 발급' },
      { text: '.env.local에 COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY 추가' },
    ],
  },
  {
    id: 'youtube',
    icon: Video,
    title: 'YouTube API',
    color: 'text-red-500',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
    required: false,
    envKey: 'YOUTUBE_REFRESH_TOKEN' as keyof EnvStatus,
    description: 'YouTube Shorts 자동 업로드 (선택)',
    steps: [
      { text: 'Google Cloud Console → 프로젝트 생성', url: 'https://console.cloud.google.com' },
      { text: 'YouTube Data API v3 활성화' },
      { text: 'OAuth 2.0 클라이언트 ID 생성 (웹 애플리케이션)' },
      { text: 'Redirect URI: http://localhost:3000/setup/youtube-callback' },
      { text: '.env.local에 YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET 추가' },
      { text: '아래 "YouTube 인증" 버튼으로 Refresh Token 발급' },
    ],
  },
  {
    id: 'cron',
    icon: Key,
    title: 'Cron 보안 키',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    required: true,
    envKey: 'CRON_SECRET' as keyof EnvStatus,
    description: '자동화 스케줄러 보안',
    steps: [
      { text: '임의 문자열 생성 (예: openssl rand -base64 32)' },
      { text: '.env.local에 CRON_SECRET=생성된값 추가' },
      { text: 'Vercel 환경변수에도 동일하게 설정' },
    ],
  },
]

export default function SetupPage() {
  const [envStatus] = useState<EnvStatus>({
    ANTHROPIC_API_KEY: !!process.env.NEXT_PUBLIC_HAS_ANTHROPIC,
    COUPANG_ACCESS_KEY: false,
    COUPANG_SECRET_KEY: false,
    YOUTUBE_CLIENT_ID: false,
    YOUTUBE_REFRESH_TOKEN: false,
    CRON_SECRET: false,
  })
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<Record<string, boolean> | null>(null)

  async function checkEnv() {
    setChecking(true)
    try {
      const res = await fetch('/api/setup/check')
      const data = await res.json()
      setCheckResult(data.keys || {})
    } catch {
      setCheckResult({})
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">API 설정 마법사</h1>
        <p className="text-gray-500 mt-1">API 키를 설정하면 완전 자율수익화가 활성화됩니다.</p>
      </div>

      {/* 전체 상태 체크 */}
      <Card className="border-2 border-indigo-100 bg-indigo-50">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-indigo-900">환경변수 상태 확인</p>
              <p className="text-sm text-indigo-700 mt-0.5">.env.local 또는 Vercel 환경변수에 키가 설정되었는지 확인합니다.</p>
            </div>
            <button
              onClick={checkEnv}
              disabled={checking}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {checking ? '확인 중...' : '상태 확인'}
            </button>
          </div>

          {checkResult && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {Object.entries(checkResult).map(([key, set]) => (
                <div key={key} className="flex items-center gap-2 text-sm">
                  {set
                    ? <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    : <Circle className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                  <span className={set ? 'text-green-800' : 'text-gray-500'}>
                    {key}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 설정 단계 */}
      <div className="space-y-4">
        {STEPS.map((step, idx) => {
          const isSet = checkResult ? checkResult[step.envKey] : envStatus[step.envKey]
          const Icon = step.icon

          return (
            <Card key={step.id} className={`border ${step.borderColor}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg ${step.bgColor} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${step.color}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{step.title}</span>
                      {step.required
                        ? <Badge variant="outline" className="text-xs border-red-200 text-red-600">필수</Badge>
                        : <Badge variant="outline" className="text-xs border-gray-200 text-gray-500">선택</Badge>}
                      {isSet && <Badge className="text-xs bg-green-100 text-green-700 border-0">✓ 설정됨</Badge>}
                    </div>
                    <p className="text-sm font-normal text-gray-500 mt-0.5">{step.description}</p>
                  </div>
                  <span className="text-lg font-bold text-gray-300">0{idx + 1}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {step.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span>
                        {s.text}
                        {'url' in s && (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-1 ml-1 ${step.color} underline`}
                          >
                            바로가기 <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 완료 후 안내 */}
      <Card className="border-2 border-green-100 bg-green-50">
        <CardContent className="pt-4 pb-4">
          <h3 className="font-semibold text-green-900">설정 완료 후</h3>
          <ul className="mt-2 space-y-1 text-sm text-green-800">
            <li>• Vercel 환경변수에 위 키들을 동일하게 설정</li>
            <li>• <strong>/automation</strong> 페이지에서 &ldquo;지금 실행&rdquo; 클릭 → 첫 자동화 실행 확인</li>
            <li>• 이후 매일 새벽 2시 자동 실행 (Cron)</li>
            <li>• 오전 9시, 오후 6시 예약 게시 자동 발행</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
