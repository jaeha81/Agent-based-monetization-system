import type { NextRequest } from 'next/server'

const encoder = new TextEncoder()
const SESSION_SECONDS = 12 * 60 * 60

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of Array.from(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function signature(payload: string): Promise<string> {
  const secret = process.env.DASHBOARD_PASSWORD
  if (!secret) throw new Error('DASHBOARD_PASSWORD가 설정되지 않았습니다.')
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))))
}

export async function createAdminSession(): Promise<string> {
  const payload = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS)
  return `${payload}.${await signature(payload)}`
}

export async function verifyAdminSession(value: string | undefined): Promise<boolean> {
  if (!value) return false
  const [expires, provided] = value.split('.')
  if (!expires || !provided || Number(expires) <= Math.floor(Date.now() / 1000)) return false
  const expected = await signature(expires).catch(() => '')
  if (provided.length !== expected.length) return false
  let mismatch = 0
  for (let i = 0; i < provided.length; i++) mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  return mismatch === 0
}

export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  return verifyAdminSession(req.cookies.get('admin_session')?.value)
}

export const adminSessionMaxAge = SESSION_SECONDS
