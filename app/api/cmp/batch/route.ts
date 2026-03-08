import { NextRequest, NextResponse } from 'next/server'

// Yahoo Finance v7 quote endpoint supports multiple symbols in one request.
// Returns { [symbol]: price } where symbol matches the input (without .NS suffix).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('symbols') ?? ''
  const symbols = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

  if (symbols.length === 0)
    return NextResponse.json({ error: 'symbols param required' }, { status: 400 })

  const nsSuffixed = symbols.map(s => `${s}.NS`).join(',')
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${nsSuffixed}`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 60 }, // Fix #6 — cache 60s; same TTL as per-symbol route
    })
    if (!res.ok) return NextResponse.json({ error: `Yahoo ${res.status}` }, { status: 502 })

    const json = await res.json()
    const results: { symbol: string; regularMarketPrice: number }[] =
      json?.quoteResponse?.result ?? []

    const prices: Record<string, number> = {}
    for (const r of results) {
      // Strip .NS suffix to match our internal symbol format
      const sym = r.symbol.replace(/\.NS$/, '')
      if (r.regularMarketPrice) prices[sym] = r.regularMarketPrice
    }

    return NextResponse.json({ prices })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 })
  }
}
