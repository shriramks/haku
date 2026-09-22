import { NextRequest, NextResponse } from 'next/server'
import { fetchAmfiNavAll, isNavStale } from '@/lib/amfi'

// Batched latest-NAV lookup backed by AMFI's official bulk file (one cached
// fetch — see lib/amfi.ts — serves every caller within the revalidate window),
// replacing the old pattern of one api.mfapi.in request per fund. Callers still
// use mfapi.in for the *previous*-day NAV (1D gain), and as a per-fund fallback
// here for scheme codes AMFI's file doesn't cover.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const codes = (searchParams.get('codes') ?? '').split(',').map(c => c.trim()).filter(Boolean)
  if (codes.length === 0)
    return NextResponse.json({ error: 'codes param required' }, { status: 400 })

  try {
    const all = await fetchAmfiNavAll()
    const navs: Record<string, { nav: number; date: string; stale: boolean }> = {}
    for (const code of codes) {
      const entry = all.get(code)
      if (entry) navs[code] = { ...entry, stale: isNavStale(entry.date) }
    }
    return NextResponse.json({ navs })
  } catch (err) {
    return NextResponse.json({ error: String(err), navs: {} }, { status: 502 })
  }
}
