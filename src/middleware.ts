import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest, verifyAdminSession } from '@/lib/admin-auth'

const PUBLIC_API_PATHS = new Set([
  '/api/auth/login', '/api/health', '/api/tracking/click', '/api/tts',
  '/api/webhook/shotstack', '/api/discord/interactions',
])

function usesRouteAuthentication(pathname: string): boolean {
  return pathname.startsWith('/api/cron/') || pathname === '/api/upload/trigger'
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.nextUrl.pathname) || usesRouteAuthentication(req.nextUrl.pathname)) {
      return NextResponse.next()
    }
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.next()
  }
  if (!await verifyAdminSession(req.cookies.get('admin_session')?.value)) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon|icons|manifest|login).*)'],
}
