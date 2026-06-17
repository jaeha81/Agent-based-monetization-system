'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Circle, ExternalLink, Key, Video, ShoppingCart, Zap, Globe, Clapperboard, BookOpen, Bell } from 'lucide-react'

interface EnvStatus {
  GEMINI_API_KEY: boolean
  COUPANG_ACCESS_KEY: boolean
  COUPANG_SECRET_KEY: boolean
  YOUTUBE_CLIENT_ID: boolean
  YOUTUBE_REFRESH_TOKEN: boolean
  CRON_SECRET: boolean
  SHOTSTACK_API_KEY: boolean
  TISTORY_ACCESS_TOKEN: boolean
  AMAZON_ASSOCIATE_TAG_US: boolean
  AMAZON_ASSOCIATE_TAG_JP: boolean
}

type StepItem = { text: string; url?: string }

interface Step {
  id: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  color: string
  bgColor: string
  borderColor: string
  required: boolean
  envKey: keyof EnvStatus
  description: string
  steps: StepItem[]
  envVars?: string[]
}

const STEPS: Step[] = [
  {
    id: 'gemini',
    icon: Zap,
    title: 'Gemini AI API (콘텐츠 생성)',
    color: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
    required: true,
    envKey: 'GEMINI_API_KEY',
    description: 'Gemini 2.5 Flash - 다국어 쇼핑 숏츠 콘텐츠 자동 생성',
    envVars: ['GEMINI_API_KEY'],
    steps: [
      { text: 'Google AI Studio 접속', url: 'https://aistudio.google.com/apikey' },
      { text: 'API Key 생성 (무료 티어 사용 가능)' },
      { text: 'Vercel 환경변수에 GEMINI_API_KEY 추가' },
    ],
  },
  {
    id: 'coupang',
    icon: ShoppingCart,
    title: '쿠팡 파트너스 (한국 어필리에이트)',
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    required: true,
    envKey: 'COUPANG_ACCESS_KEY',
    description: '트렌딩 제품 발굴 + 어필리에이트 링크 자동 생성 (수수료 2~8%)',
    envVars: ['COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY'],
    steps: [
      { text: '쿠팡 파트너스 가입', url: 'https://partners.coupang.com' },
      { text: '마이페이지 → API 연동 → 액세스 키 / 시크릿 키 발급' },
      { text: 'Vercel에 COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY 추가' },
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
    envKey: 'CRON_SECRET',
    description: '자동화 스케줄러 보안 토큰 (Vercel Cron 인증)',
    envVars: ['CRON_SECRET'],
    steps: [
      { text: '터미널에서 랜덤 키 생성: openssl rand -base64 32' },
      { text: 'Vercel 환경변수에 CRON_SECRET=생성된값 추가' },
      { text: 'Vercel Cron 설정에서 Authorization 헤더에 Bearer 토큰 입력' },
    ],
  },
  {
    id: 'youtube',
    icon: Video,
    title: 'YouTube API (Shorts 자동 업로드)',
    color: 'text-red-500',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
    required: false,
    envKey: 'YOUTUBE_REFRESH_TOKEN',
    description: 'YouTube Data API v3 - Shorts 영상 자동 업로드 (선택)',
    envVars: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'YOUTUBE_CHANNEL_ID'],
    steps: [
      { text: 'Google Cloud Console → 프로젝트 생성', url: 'https://console.cloud.google.com' },
      { text: 'YouTube Data API v3 활성화' },
      { text: 'OAuth 2.0 클라이언트 ID 생성 (웹 애플리케이션)' },
      { text: 'Google OAuth Playground에서 Refresh Token 발급', url: 'https://developers.google.com/oauthplayground' },
      { text: 'Vercel에 YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN 추가' },
    ],
  },
  {
    id: 'shotstack',
    icon: Clapperboard,
    title: 'Shotstack (AI 영상 자동 생성)',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    required: false,
    envKey: 'SHOTSTACK_API_KEY',
    description: '텍스트 기반 30초 쇼츠 영상 자동 생성 후 YouTube 업로드',
    envVars: ['SHOTSTACK_API_KEY', 'SHOTSTACK_STAGE'],
    steps: [
      { text: 'Shotstack 가입 (무료 워터마크 플랜 또는 유료)', url: 'https://shotstack.io' },
      { text: 'Dashboard → API Keys에서 키 복사' },
      { text: 'Vercel에 SHOTSTACK_API_KEY 추가 (SHOTSTACK_STAGE=production 선택)' },
    ],
  },
  {
    id: 'tistory',
    icon: BookOpen,
    title: 'Tistory API (블로그 자동 포스팅)',
    color: 'text-orange-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    required: false,
    envKey: 'TISTORY_ACCESS_TOKEN',
    description: '한국 마켓 - Tistory 블로그 어필리에이트 포스팅 자동화',
    envVars: ['TISTORY_ACCESS_TOKEN', 'TISTORY_BLOG_NAME'],
    steps: [
      { text: 'Tistory 블로그 개설 후 개발자 앱 등록', url: 'https://www.tistory.com/guide/api/manage/register' },
      { text: 'App ID / Secret Key 발급' },
      { text: 'OAuth 인증 코드로 Access Token 발급' },
      { text: 'Vercel에 TISTORY_ACCESS_TOKEN, TISTORY_BLOG_NAME 추가' },
    ],
  },
  {
    id: 'global',
    icon: Globe,
    title: 'Amazon Associates (글로벌 마켓)',
    color: 'text-amber-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    required: false,
    envKey: 'AMAZON_ASSOCIATE_TAG_US',
    description: '미국/일본/영국/독일/호주 Amazon Associates 어필리에이트 (선택)',
    envVars: ['TARGET_MARKETS', 'AMAZON_ASSOCIATE_TAG_US', 'AMAZON_ASSOCIATE_TAG_JP', 'AMAZON_ASSOCIATE_TAG_GB', 'AMAZON_ASSOCIATE_TAG_DE', 'AMAZON_ASSOCIATE_TAG_AU'],
    steps: [
      { text: 'Amazon Associates 각 국가별 가입 (미국/일본 등)', url: 'https://affiliate-program.amazon.com' },
      { text: '각 국가의 Associate Tag 발급 (예: mysite-20)' },
      { text: 'Vercel에 AMAZON_ASSOCIATE_TAG_US, _JP 등 추가' },
      { text: 'TARGET_MARKETS=KR,US,JP 형태로 활성 마켓 설정 (기본: KR)' },
    ],
  },
  {
    id: 'discord',
    icon: Bell,
    title: 'Discord 알림 (선택)',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    required: false,
    envKey: 'CRON_SECRET',
    description: '자동화 결과를 Discord로 실시간 알림',
    envVars: ['DISCORD_NOTIFY_WEBHOOK', 'DISCORD_PUBLIC_KEY', 'DISCORD_APPLICATION_ID'],
    steps: [
      { text: 'Discord 서버에서 채널 → 웹훅 URL 복사' },
      { text: 'Vercel에 DISCORD_NOTIFY_WEBHOOK=https://discord.com/api/webhooks/... 추가' },
    ],
  },
]

export default function SetupPage() {
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<Record<string, boolean> | null>(null)
  const [setupInfo, setSetupInfo] = useState<{ activeMarkets?: string[]; automationReady?: boolean; videoReady?: boolean; blogReady?: boolean; globalReady?: boolean } | null>(null)

  async function checkEnv() {
    setChecking(true)
    try {
      const res = await fetch('/api/setup/check')
      const data = await res.json()
      setCheckResult(data.keys || {})
      setSetupInfo(data)
    } catch {
      setCheckResult({})
    } finally {
      setChecking(false)
    }
  }

  const readyCount = checkResult ? Object.values(checkResult).filter(Boolean).length : 0
  const totalCount = checkResult ? Object.keys(checkResult).length : 0

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">API 설정 가이드</h1>
        <p className="text-gray-500 mt-1">필수 API 키를 설정하면 완전 자율수익화가 활성화됩니다.</p>
      </div>

      {/* 전체 상태 체크 */}
      <Card className="border-2 border-indigo-100 bg-indigo-50">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-indigo-900">Vercel 환경변수 상태 확인</p>
              <p className="text-sm text-indigo-700 mt-0.5">현재 배포된 환경의 API 키 설정 상태를 실시간으로 확인합니다.</p>
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
            <>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1 bg-white rounded-full h-2 overflow-hidden">
                  <div className="h-2 bg-indigo-500 rounded-full transition-all" style={{ width: `${(readyCount / totalCount) * 100}%` }} />
                </div>
                <span className="text-sm font-bold text-indigo-700">{readyCount}/{totalCount}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {Object.entries(checkResult).map(([key, set]) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    {set
                      ? <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                      : <Circle className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                    <span className={set ? 'text-green-800 font-medium' : 'text-gray-500'}>
                      {key}
                    </span>
                  </div>
                ))}
              </div>

              {setupInfo && (
                <div className="mt-3 pt-3 border-t border-indigo-200 flex flex-wrap gap-2">
                  <Badge className={setupInfo.automationReady ? 'bg-green-100 text-green-700 border-0' : 'bg-gray-100 text-gray-500 border-0'}>
                    {setupInfo.automationReady ? '✓' : '○'} 자동화
                  </Badge>
                  <Badge className={setupInfo.videoReady ? 'bg-green-100 text-green-700 border-0' : 'bg-gray-100 text-gray-500 border-0'}>
                    {setupInfo.videoReady ? '✓' : '○'} 영상 생성
                  </Badge>
                  <Badge className={setupInfo.blogReady ? 'bg-green-100 text-green-700 border-0' : 'bg-gray-100 text-gray-500 border-0'}>
                    {setupInfo.blogReady ? '✓' : '○'} 블로그 포스팅
                  </Badge>
                  <Badge className={setupInfo.globalReady ? 'bg-green-100 text-green-700 border-0' : 'bg-gray-100 text-gray-500 border-0'}>
                    {setupInfo.globalReady ? '✓' : '○'} 글로벌 마켓
                  </Badge>
                  {setupInfo.activeMarkets && (
                    <Badge className="bg-blue-100 text-blue-700 border-0">
                      활성 마켓: {setupInfo.activeMarkets.join(', ')}
                    </Badge>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 설정 단계 */}
      <div className="space-y-4">
        {STEPS.map((step, idx) => {
          const isSet = checkResult ? checkResult[step.envKey] : false
          const Icon = step.icon

          return (
            <Card key={step.id} className={`border ${step.borderColor}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg ${step.bgColor} flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-5 h-5 ${step.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base">{step.title}</span>
                      {step.required
                        ? <Badge variant="outline" className="text-xs border-red-200 text-red-600">필수</Badge>
                        : <Badge variant="outline" className="text-xs border-gray-200 text-gray-500">선택</Badge>}
                      {isSet && <Badge className="text-xs bg-green-100 text-green-700 border-0">✓ 설정됨</Badge>}
                    </div>
                    <p className="text-sm font-normal text-gray-500 mt-0.5">{step.description}</p>
                  </div>
                  <span className="text-lg font-bold text-gray-200 flex-shrink-0">0{idx + 1}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ol className="space-y-2">
                  {step.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span>
                        {s.text}
                        {s.url && (
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
                {step.envVars && (
                  <div className="bg-gray-900 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1.5">Vercel 환경변수 키 이름:</p>
                    {step.envVars.map(v => (
                      <div key={v} className="font-mono text-xs text-green-400">{v}</div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 완료 후 안내 */}
      <Card className="border-2 border-green-100 bg-green-50">
        <CardContent className="pt-4 pb-4">
          <h3 className="font-semibold text-green-900">설정 완료 후 자동화 흐름</h3>
          <ul className="mt-2 space-y-1 text-sm text-green-800">
            <li>• <strong>매일 새벽 2시 (KST)</strong>: 트렌드 제품 발굴 → 콘텐츠 생성 → 스케줄 등록</li>
            <li>• <strong>2시간마다</strong>: 예약된 게시물 자동 발행 (YouTube 업로드 포함)</li>
            <li>• <strong>오전 6시 (KST)</strong>: 수익 동기화 및 클릭 통계 업데이트</li>
            <li>• <strong>/automation</strong> 에서 &ldquo;지금 실행&rdquo;으로 즉시 실행 가능</li>
            <li>• Discord 웹훅 설정 시 실행 결과 실시간 알림</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
