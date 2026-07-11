const encoder = new TextEncoder()

async function sign(value: string): Promise<string> {
  const secret = process.env.TTS_SIGNING_SECRET || process.env.CRON_SECRET
  if (!secret) throw new Error('TTS_SIGNING_SECRET 미설정')
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function createTtsToken(text: string, lang: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + 15 * 60
  return `${expires}.${await sign(`${expires}:${lang}:${text}`)}`
}

export async function verifyTtsToken(text: string, lang: string, token: string | null): Promise<boolean> {
  if (!token) return false
  const [expires, provided] = token.split('.')
  if (!expires || !provided || Number(expires) < Math.floor(Date.now() / 1000)) return false
  const expected = await sign(`${expires}:${lang}:${text}`).catch(() => '')
  if (expected.length !== provided.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  return mismatch === 0
}
