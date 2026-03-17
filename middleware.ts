import { type CookieOptions, createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

const PROTECTED = ['/dashboard', '/bands', '/plan', '/transactions', '/stocks', '/add']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only protect app routes
  if (!PROTECTED.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const res = NextResponse.next()

  // getSession() reads the cookie locally — no network call
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value)
            res.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return res
}

export const config = {
  matcher: ['/dashboard/:path*', '/bands/:path*', '/plan/:path*', '/transactions/:path*', '/stocks/:path*', '/add/:path*'],
}
