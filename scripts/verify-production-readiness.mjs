const required = [
  'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'GEMINI_API_KEY', 'CRON_SECRET', 'UPLOAD_SECRET',
  'DASHBOARD_PASSWORD', 'COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY',
  'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'YOUTUBE_API_KEY',
  'SHOTSTACK_API_KEY', 'SHOTSTACK_STAGE', 'SHOTSTACK_WEBHOOK_SECRET', 'GOOGLE_TTS_API_KEY', 'TTS_SIGNING_SECRET',
  'CLICK_HASH_SECRET', 'NEXT_PUBLIC_APP_URL',
]
const placeholder = /^(your-|AIza\.\.\.|UCx+|1\/\/your|libsql:\/\/your|https:\/\/.*YOUR_)/i
const failures = []
const warnings = []

for (const key of required) {
  const value = (process.env[key] || '').trim()
  if (!value) failures.push(`${key}: 미설정`)
  else if (placeholder.test(value)) failures.push(`${key}: 예시 placeholder 값`)
}

for (const key of ['CRON_SECRET', 'UPLOAD_SECRET', 'DASHBOARD_PASSWORD', 'SHOTSTACK_WEBHOOK_SECRET', 'TTS_SIGNING_SECRET', 'CLICK_HASH_SECRET']) {
  if (process.env[key] && process.env[key].length < 24) failures.push(`${key}: 최소 24자 필요`)
}
const secrets = ['CRON_SECRET', 'UPLOAD_SECRET', 'DASHBOARD_PASSWORD', 'SHOTSTACK_WEBHOOK_SECRET', 'TTS_SIGNING_SECRET', 'CLICK_HASH_SECRET']
for (let i = 0; i < secrets.length; i++) for (let j = i + 1; j < secrets.length; j++) {
  if (process.env[secrets[i]] && process.env[secrets[i]] === process.env[secrets[j]]) failures.push(`${secrets[i]}와 ${secrets[j]}는 서로 달라야 함`)
}

if (process.env.SHOTSTACK_STAGE !== 'v1') failures.push('SHOTSTACK_STAGE: 프로덕션은 v1이어야 함')
if (process.env.USE_MOCK_DATA === 'true') failures.push('USE_MOCK_DATA: 프로덕션에서 true 금지')
if (process.env.NEXT_PUBLIC_APP_URL && !/^https:\/\//.test(process.env.NEXT_PUBLIC_APP_URL)) failures.push('NEXT_PUBLIC_APP_URL: HTTPS URL 필요')
if (process.env.AUTO_PUBLISH_ENABLED === 'true') {
  const limit = Number(process.env.AUTO_PUBLISH_DAILY_LIMIT || 0)
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) failures.push('AUTO_PUBLISH_DAILY_LIMIT: 자동공개 시 1~3 필요')
} else warnings.push('AUTO_PUBLISH_ENABLED=false: QA 후 자동 공개 비활성')
if (process.env.SHORTS_DISCORD_PUBLIC_KEY && !process.env.SHORTS_DISCORD_ADMIN_USER_IDS) failures.push('SHORTS_DISCORD_ADMIN_USER_IDS: Discord /실행 허용 사용자 필요')

for (const key of ['COST_VEO_RENDER_KRW','COST_SHOTSTACK_RENDER_KRW','COST_IMAGE_GENERATION_KRW','COST_TTS_KRW','COST_LLM_CONTENT_KRW']) {
  const value = Number(process.env[key])
  if (!Number.isFinite(value) || value <= 0) warnings.push(`${key}: 실제 단가 미설정, 코드 기본값 사용`)
}

console.log('[Production Readiness]')
for (const warning of warnings) console.log(`WARN  ${warning}`)
for (const failure of failures) console.error(`FAIL  ${failure}`)
if (failures.length) {
  console.error(`결과: FAIL (${failures.length}개 차단 조건)`)
  process.exit(1)
}
console.log('결과: PASS — 비밀값은 출력하지 않았습니다.')
