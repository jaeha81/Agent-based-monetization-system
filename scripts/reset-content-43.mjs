// 1회용 운영 스크립트: content_id=43 을 posted → draft 로 리셋
//
// 목적: 테스트 영상(Mmwf2DsJ7is) 업로드로 posted 처리된 content_id=43 을
//       재업로드 가능한 draft 상태로 되돌린다. (데이터 UPDATE only, 스키마 변경 없음)
//
// 안전장치:
//   - 프로덕션 Turso 자격(TURSO_DATABASE_URL)이 없으면 즉시 중단.
//     로컬 파일 DB(data/shorts.db)를 실수로 건드리지 않기 위함.
//   - 실행 전/후 상태를 출력하여 증거를 남긴다.
//   - --confirm 플래그 없이는 dry-run(읽기만)으로 동작.
//
// 사용법 (PowerShell):
//   $env:TURSO_DATABASE_URL = "libsql://..."
//   $env:TURSO_AUTH_TOKEN   = "..."
//   node scripts/reset-content-43.mjs            # dry-run (현재 상태만 확인)
//   node scripts/reset-content-43.mjs --confirm  # 실제 리셋 실행

import { createClient } from '@libsql/client'

const CONTENT_ID = 43
const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
const confirm = process.argv.includes('--confirm')

if (!url) {
  console.error('❌ TURSO_DATABASE_URL 미설정. 프로덕션 자격을 셸에 주입한 후 실행하세요.')
  console.error('   (로컬 파일 DB 오작동 방지를 위해 중단합니다.)')
  process.exit(1)
}
if (!url.startsWith('libsql://') && !url.startsWith('https://')) {
  console.error(`❌ TURSO_DATABASE_URL 이 원격 주소가 아닙니다 (${url.split(':')[0]}:...). 프로덕션 URL인지 확인하세요.`)
  process.exit(1)
}

const client = createClient(authToken ? { url, authToken } : { url })

async function snapshot(label) {
  const c = await client.execute({
    sql: 'SELECT id, status, posted_at, video_url, render_status FROM content WHERE id = ?',
    args: [CONTENT_ID],
  })
  const sp = await client.execute({
    sql: 'SELECT id, status, youtube_video_id, published_at FROM scheduled_posts WHERE content_id = ?',
    args: [CONTENT_ID],
  })
  console.log(`\n── ${label} ──`)
  console.log('content:', JSON.stringify(c.rows[0] ?? null))
  console.log('scheduled_posts:', JSON.stringify(sp.rows.map(r => ({ ...r }))))
  return { content: c.rows[0] ?? null, scheduled: sp.rows }
}

const before = await snapshot('실행 전')

if (!before.content) {
  console.error(`\n❌ content_id=${CONTENT_ID} 가 존재하지 않습니다. 중단합니다.`)
  process.exit(1)
}

if (!confirm) {
  console.log('\nℹ️  dry-run 모드입니다. 실제 리셋하려면 --confirm 플래그를 붙여 다시 실행하세요.')
  process.exit(0)
}

await client.execute({
  sql: `UPDATE content
        SET status = 'draft', posted_at = NULL, video_url = NULL,
            render_status = 'idle', render_id = NULL
        WHERE id = ?`,
  args: [CONTENT_ID],
})
await client.execute({
  sql: `UPDATE scheduled_posts
        SET status = 'pending', youtube_video_id = NULL, published_at = NULL
        WHERE content_id = ?`,
  args: [CONTENT_ID],
})

await snapshot('실행 후')
console.log('\n✅ content_id=43 draft 리셋 완료.')
