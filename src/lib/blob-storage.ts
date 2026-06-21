import { put, del } from '@vercel/blob'

// Veo 영상(인증 필요 URI) → Vercel Blob 임시 공개 URL 변환
// Instagram/TikTok API는 공개 URL만 허용하므로 필수
export async function uploadVideoToBlob(
  videoBuffer: Buffer,
  filename: string,
): Promise<{ url: string; blobUrl: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN 미설정 — Vercel Blob 사용 불가')
  }

  const blob = await put(`videos/${filename}`, videoBuffer, {
    access: 'public',
    contentType: 'video/mp4',
  })

  return { url: blob.url, blobUrl: blob.url }
}

// 업로드 완료 후 Blob 정리 (24시간 이내 호출 권장)
export async function deleteBlob(blobUrl: string): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return
  try {
    await del(blobUrl)
  } catch {
    console.warn('[Blob] 삭제 실패 (무시):', blobUrl)
  }
}
