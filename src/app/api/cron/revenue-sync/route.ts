import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { getVideosStats, getYouTubeRetentionCurve, getYouTubeVideoAnalytics } from '@/lib/youtube'
import { pollWaitingVideoRenders } from '@/lib/workflow-engine'
import { publishQaApprovedVideos } from '@/lib/publish-gate'
import { refreshProductProfitability } from '@/lib/profitability'
import { refreshProductDecisions } from '@/lib/product-selection'
import { syncCoupangRevenueReports, syncYouTubeEstimatedRevenue } from '@/lib/revenue-sync'

export const runtime = 'nodejs'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hasYoutubeCredentials = Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN)
  const endDate = new Date().toISOString().slice(0, 10)
  const coupangStart = new Date()
  coupangStart.setDate(coupangStart.getDate() - 30)
  const coupangStartDate = coupangStart.toISOString().slice(0, 10)
  const coupangRevenue = process.env.COUPANG_ACCESS_KEY && process.env.COUPANG_SECRET_KEY
    ? await syncCoupangRevenueReports(coupangStartDate, endDate).catch(error => {
        console.error('[revenue-sync] 쿠팡 리포트 오류:', error instanceof Error ? error.message : 'unknown')
        return { status: 'error', received: 0, inserted: 0, updated: 0, unmatched: 0, skipped: 0, pendingAmount: 0 }
      })
    : { status: 'skipped_missing_credentials', received: 0, inserted: 0, updated: 0, unmatched: 0, skipped: 0, pendingAmount: 0 }

  if (!hasYoutubeCredentials) {
    return NextResponse.json({ ok: true, message: 'YouTube 자격증명 미설정', updated: 0, renderResumed: 0, coupangRevenue })
  }

  // 17:00 daily cron에서 제출된 Veo/Shotstack 렌더가 완료됐는지 폴링 → youtube_upload 트리거
  // YouTube 자격증명 확인 후에만 폴링 — 토큰 무효 시 완성 렌더를 소비→업로드 실패→영상 유실 방지
  const renderResumed = await pollWaitingVideoRenders(20).catch(e => {
    console.error('[revenue-sync] 렌더 폴링 오류:', e instanceof Error ? e.message : String(e))
    return 0
  })
  console.log(`[revenue-sync] 렌더 폴링 완료: ${renderResumed}건 업로드 트리거됨`)

  // YouTube에 실제 업로드된 콘텐츠의 조회수 가져오기
  const postedYoutube = await query<{
    id: number; youtube_video_id: string | null; content_id: number; hook: string | null; product_name: string
    avg_view_duration: number; avg_view_percentage: number
    last_retention_success_at: string | null
  }>(
    `SELECT sp.id, sp.youtube_video_id, sp.content_id, c.hook, p.name AS product_name,
            c.avg_view_duration, c.avg_view_percentage, c.last_retention_success_at
     FROM scheduled_posts sp
     JOIN content c ON c.id = sp.content_id
     JOIN products p ON p.id = c.product_id
     WHERE sp.platform = 'YouTube'
       AND sp.status = 'published'
       AND sp.youtube_video_id IS NOT NULL
     ORDER BY COALESCE(c.last_analytics_success_at, '1970-01-01') ASC, sp.published_at DESC
     LIMIT 20`
  )

  const videoIds = postedYoutube.flatMap(post => post.youtube_video_id ? [post.youtube_video_id] : [])
  const start = new Date()
  start.setDate(start.getDate() - 90)
  const startDate = start.toISOString().slice(0, 10)
  const youtubeRevenue = await syncYouTubeEstimatedRevenue(startDate, endDate).catch(error => {
    console.error('[revenue-sync] YouTube 추정 수익 오류:', error instanceof Error ? error.message : 'unknown')
    return { status: 'error', received: 0, inserted: 0, updated: 0, unmatched: 0, skipped: 0, pendingAmount: 0 }
  })
  const [details, analytics] = await Promise.all([
    getVideosStats(videoIds),
    getYouTubeVideoAnalytics(videoIds, startDate, endDate),
  ])

  let updated = 0
  let retentionCurvesUpdated = 0
  for (const post of postedYoutube) {
    if (!post.youtube_video_id) continue
    const detail = details[post.youtube_video_id]
    if (!detail) continue
    const watch = analytics[post.youtube_video_id]
    if (!watch) throw new Error(`YouTube Analytics row missing for video ${post.youtube_video_id}`)
    await execute(`
      UPDATE content SET music_track_id = COALESCE(music_track_id, (
        SELECT music_track_id FROM music_assignments
        WHERE assignment_key IN (?, ?) ORDER BY assigned_at DESC LIMIT 1
      )) WHERE id = ?
    `, [post.product_name, post.hook || '', post.content_id])
    const clicks = await query<{ c: number }>(
      'SELECT COUNT(*) as c FROM click_logs WHERE content_id = ?', [post.content_id]
    )
    const clickCount = Number(clicks[0]?.c || 0)
    const views = Math.max(detail.views, watch?.views || 0)
    const engagedViews = Math.max(0, watch.engagedViews || 0)
    const retention = Math.min(100, Math.max(0, watch?.averageViewPercentage ?? Number(post.avg_view_percentage || 0)))
    const averageViewDuration = watch?.averageViewDuration ?? Number(post.avg_view_duration || 0)
    const clickRate = views > 0 ? clickCount / views * 100 : 0
    const engagementRate = engagedViews > 0 ? detail.likes / engagedViews * 100 : 0
    const clickableCommerce = process.env.YOUTUBE_CLICKABLE_COMMERCE_ENABLED === 'true'
    const performanceScore = Math.round((clickableCommerce
      ? retention * 0.45 + Math.min(25, Math.log10(engagedViews + 1) * 6)
        + Math.min(20, clickRate * 2) + Math.min(10, engagementRate * 2)
      : retention * 0.55 + Math.min(30, Math.log10(engagedViews + 1) * 7)
        + Math.min(15, engagementRate * 3)
    ) * 100) / 100

    await execute(
      `UPDATE content
       SET views = ?, engaged_views = ?, likes = ?, avg_view_duration = ?, avg_view_percentage = ?,
           click_count = ?, performance_score = ?, metrics_source = 'youtube_api',
           metrics_window_start = ?, metrics_window_end = ?, last_analytics_success_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`,
      [views, engagedViews, detail.likes, averageViewDuration, retention,
       clickCount, performanceScore, startDate, endDate, post.content_id]
    )
    await execute(
      `INSERT OR REPLACE INTO youtube_metric_snapshots
       (content_id, snapshot_date, window_start, window_end, views, engaged_views, likes, clicks, avg_view_duration, avg_view_percentage, collected_at)
       VALUES (?, date('now'), ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [post.content_id, startDate, endDate, views, engagedViews, detail.likes, clickCount, averageViewDuration, retention]
    )
    const retentionStale = !post.last_retention_success_at
      || Date.now() - new Date(post.last_retention_success_at).getTime() >= 7 * 24 * 60 * 60 * 1000
    if (engagedViews >= 300 && retentionStale && retentionCurvesUpdated < 3) {
      try {
        const points = await getYouTubeRetentionCurve(post.youtube_video_id, startDate, endDate)
        for (const point of points) await execute(
          `INSERT OR REPLACE INTO youtube_retention_points
           (content_id, window_start, window_end, elapsed_ratio, audience_watch_ratio, relative_retention, collected_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          [post.content_id, startDate, endDate, point.elapsedRatio, point.audienceWatchRatio, point.relativeRetention]
        )
        await execute(`UPDATE content SET last_retention_success_at = datetime('now') WHERE id = ?`, [post.content_id])
        retentionCurvesUpdated++
      } catch (error) {
        console.warn(`[revenue-sync] retention curve ${post.content_id} skipped:`, error)
      }
    }
    updated++
  }

  await execute(`
    UPDATE content SET click_count = COALESCE(
      (SELECT COUNT(*) FROM click_logs cl WHERE cl.content_id = content.id), 0
    )
  `)
  await execute(`
    UPDATE products
    SET total_views = COALESCE((SELECT SUM(c.views) FROM content c WHERE c.product_id = products.id AND c.platform = 'YouTube' AND c.metrics_source = 'youtube_api'), 0),
        total_engaged_views = COALESCE((SELECT SUM(c.engaged_views) FROM content c WHERE c.product_id = products.id AND c.platform = 'YouTube' AND c.metrics_source = 'youtube_api'), 0),
        total_clicks = COALESCE((SELECT SUM(c.click_count) FROM content c WHERE c.product_id = products.id AND c.platform = 'YouTube' AND c.metrics_source = 'youtube_api'), 0),
        avg_retention = COALESCE((SELECT AVG(c.avg_view_percentage) FROM content c WHERE c.product_id = products.id AND c.platform = 'YouTube' AND c.metrics_source = 'youtube_api' AND c.views > 0), 0),
        performance_score = COALESCE((SELECT AVG(c.performance_score) FROM content c WHERE c.product_id = products.id AND c.platform = 'YouTube' AND c.metrics_source = 'youtube_api' AND c.views > 0), 0),
        last_performance_sync_at = datetime('now')
  `)
  await refreshProductProfitability()
  await refreshProductDecisions()

  await execute(`
    UPDATE music_tracks
    SET observed_videos = COALESCE((SELECT COUNT(*) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100), 0),
        observed_views = COALESCE((SELECT SUM(c.views) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100), 0),
        evidence_confidence = MIN(1.0, COALESCE((SELECT SUM(c.views) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100), 0) / 3000.0),
        avg_retention = CASE WHEN (SELECT COUNT(*) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100) >= 3
          AND (SELECT COALESCE(SUM(c.views),0) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100) >= 1000
          THEN (SELECT (SUM(c.avg_view_percentage * c.views) + 50000.0) / (SUM(c.views) + 1000.0) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100) ELSE 0 END,
        avg_click_rate = CASE WHEN (SELECT COUNT(*) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100) >= 3
          THEN (SELECT (SUM(c.click_count) + 10.0) * 100.0 / (SUM(c.views) + 1000.0) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100) ELSE 0 END,
        performance_score = CASE WHEN (SELECT COUNT(*) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100) >= 3
          AND (SELECT COALESCE(SUM(c.views),0) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100) >= 1000
          THEN (SELECT (SUM(c.performance_score * c.views) + 50000.0) / (SUM(c.views) + 1000.0) FROM content c WHERE c.music_track_id = music_tracks.id AND c.metrics_source = 'youtube_api' AND c.views >= 100) ELSE 0 END
  `)

  const publishResult = await publishQaApprovedVideos().catch(error => {
    console.error('[revenue-sync] QA 통과 영상 공개 오류:', error)
    return { attempted: 0, published: 0, failed: 1 }
  })

  return NextResponse.json({
    ok: true,
    message: `YouTube 실제 조회수 ${updated}개 업데이트 완료. 쿠팡 수수료는 partners.coupang.com에서 확인하세요.`,
    updated,
    retentionCurvesUpdated,
    renderResumed,
    publishResult,
    coupangRevenue,
    youtubeRevenue,
  })
}
