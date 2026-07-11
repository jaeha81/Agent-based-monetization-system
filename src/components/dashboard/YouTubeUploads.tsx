'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'

interface VideoDetail {
  views: number
  likes: number
  privacy: 'public' | 'private' | 'unlisted' | 'unknown'
  thumbnail: string
  publishedAt: string | null
}

interface UploadItem {
  sp_id: number
  youtube_video_id: string
  sp_status: string
  published_at: string | null
  sp_created_at: string
  sp_error: string | null
  content_id: number
  platform: string
  hook: string | null
  product_name: string | null
  category: string | null
  youtube_url: string
  studio_url: string
  yt: VideoDetail | null
}

const PRIVACY_LABEL: Record<string, { label: string; cls: string }> = {
  public:   { label: '공개',   cls: 'bg-green-100 text-green-700 border-green-200' },
  private:  { label: '비공개', cls: 'bg-red-100 text-red-700 border-red-200' },
  unlisted: { label: '일부공개', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  unknown:  { label: '확인중', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

export default function YouTubeUploads() {
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/youtube/uploads')
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setUploads(d.uploads ?? [])
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-xs text-red-500 text-center py-4">
        YouTube API 오류: {error}
      </p>
    )
  }

  if (uploads.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-400">아직 업로드된 YouTube 영상이 없습니다</p>
        <p className="text-xs text-gray-300 mt-1">자동화 실행 후 Shotstack 렌더 완료 시 자동 업로드됩니다</p>
      </div>
    )
  }

  const privateCount = uploads.filter(u => u.yt?.privacy === 'private').length
  const publicCount = uploads.filter(u => u.yt?.privacy === 'public').length
  const totalViews = uploads.reduce((s, u) => s + (u.yt?.views ?? 0), 0)

  return (
    <div className="space-y-3">
      {/* 요약 배지 */}
      <div className="flex items-center gap-3 text-xs">
        <span className="px-2 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full font-medium">
          공개 {publicCount}개
        </span>
        {privateCount > 0 && (
          <span className="px-2 py-1 bg-red-50 text-red-700 border border-red-200 rounded-full font-medium">
            비공개 {privateCount}개
          </span>
        )}
        {totalViews > 0 && (
          <span className="px-2 py-1 bg-gray-50 text-gray-600 border border-gray-200 rounded-full">
            총 조회 {totalViews.toLocaleString()}회
          </span>
        )}
      </div>

      {/* 영상 목록 */}
      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {uploads.map(u => {
          const privacy = u.yt?.privacy ?? 'unknown'
          const badge = PRIVACY_LABEL[privacy] ?? PRIVACY_LABEL.unknown
          return (
            <div key={u.sp_id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-200 transition-colors">
              {/* 썸네일 */}
              {u.yt?.thumbnail ? (
                <Image
                  src={u.yt.thumbnail}
                  alt=""
                  width={80}
                  height={45}
                  unoptimized
                  className="w-20 h-[45px] object-cover rounded flex-shrink-0"
                />
              ) : (
                <div className="w-20 h-[45px] bg-gray-100 rounded flex-shrink-0 flex items-center justify-center">
                  <span className="text-gray-300 text-xs">▶</span>
                </div>
              )}

              {/* 정보 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                  <span className="text-xs text-gray-700 truncate font-medium">
                    {u.hook ?? u.product_name ?? `영상 ${u.sp_id}`}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  {u.product_name && <span>{u.product_name}</span>}
                  {u.yt && (
                    <>
                      <span>·</span>
                      <span>👁 {u.yt.views.toLocaleString()}</span>
                      <span>👍 {u.yt.likes.toLocaleString()}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>{new Date(u.sp_created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>

              {/* 액션 버튼 */}
              <div className="flex gap-1.5 flex-shrink-0">
                <a
                  href={u.studio_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded font-medium transition-colors"
                  title="YouTube Studio에서 편집/공개 전환"
                >
                  Studio
                </a>
                {privacy === 'public' && (
                  <a
                    href={u.youtube_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-white rounded font-medium transition-colors"
                  >
                    보기
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 비공개 안내 */}
      {privateCount > 0 && (
        <div className="flex items-start gap-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
          <span className="text-yellow-500 text-sm mt-0.5">⚠</span>
          <p className="text-xs text-yellow-700">
            비공개 영상 {privateCount}개가 있습니다.{' '}
            <strong>Studio</strong> 버튼을 눌러 YouTube Studio에서 공개로 전환해야 조회수·수익이 발생합니다.
          </p>
        </div>
      )}
    </div>
  )
}
