import { type CookieOptions, createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getSession() decodes JWT locally — no network call.
  // Sufficient for redirect gating; data queries enforce user_id in DB.
  const { data: { session } } = await supabase.auth.getSession()
  const path = request.nextUrl.pathname

  if (!session && path !== '/login') {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (session && path === '/login') {
    return NextResponse.redirect(new URL('/allocation', request.url))
  }

  return supabaseResponse
}

export const config = {
  // Only run on app pages — skip static assets, API routes, and public files
  matcher: ['/allocation/:path*', '/bands/:path*', '/plan/:path*', '/transactions/:path*', '/stocks/:path*', '/add/:path*', '/login'],
}
