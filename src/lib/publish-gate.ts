import { execute, query, queryOne } from '@/lib/db'
import { updateVideoPrivacy } from '@/lib/youtube'

export async function publishQaApprovedVideos(limit?: number): Promise<{
  attempted: number; published: number; failed: number
}> {
  if (process.env.AUTO_PUBLISH_ENABLED !== 'true') return { attempted: 0, published: 0, failed: 0 }

  const dailyLimit = Math.max(1, Math.min(Number(process.env.AUTO_PUBLISH_DAILY_LIMIT || 2), 10))
  const alreadyPublished = await queryOne<{ c: number }>(`
    SELECT COUNT(*) AS c FROM scheduled_posts
    WHERE platform = 'YouTube' AND visibility = 'public' AND published_at >= date('now')
  `)
  const capacity = Math.max(0, dailyLimit - Number(alreadyPublished?.c || 0))
  const take = Math.min(capacity, limit ?? capacity)
  if (take <= 0) return { attempted: 0, published: 0, failed: 0 }

  const candidates = await query<{ id: number; content_id: number; youtube_video_id: string }>(`
    SELECT id, content_id, youtube_video_id
    FROM scheduled_posts
    WHERE platform = 'YouTube' AND status = 'uploaded_private'
      AND visibility = 'private' AND qa_status = 'passed' AND qa_score = 100
      AND youtube_video_id IS NOT NULL
    ORDER BY created_at ASC LIMIT ?
  `, [take])

  let published = 0
  let failed = 0
  for (const candidate of candidates) {
    try {
      await updateVideoPrivacy(candidate.youtube_video_id, 'public')
      await execute(
        `UPDATE scheduled_posts
         SET status = 'published', visibility = 'public', published_at = datetime('now'), error = NULL
         WHERE id = ?`, [candidate.id]
      )
      await execute(
        `UPDATE content SET status = 'posted', posted_at = datetime('now') WHERE id = ?`,
        [candidate.content_id]
      )
      published++
    } catch (error) {
      await execute('UPDATE scheduled_posts SET error = ? WHERE id = ?', [
        error instanceof Error ? error.message : String(error), candidate.id,
      ])
      failed++
    }
  }
  return { attempted: candidates.length, published, failed }
}

