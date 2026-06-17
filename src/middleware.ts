import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  if (!req.cookies.get('pwd_ok')) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon|icons|manifest|login).*)'],
}
