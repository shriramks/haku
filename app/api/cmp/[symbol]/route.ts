import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 60 }, // cache 60s
    })
    if (!res.ok) return NextResponse.json({ error: 'Yahoo fetch failed' }, { status: 502 })

    const json = await res.json()
    const price: number | undefined = json?.chart?.result?.[0]?.meta?.regularMarketPrice
    if (!price) return NextResponse.json({ error: 'Price not found' }, { status: 404 })

    return NextResponse.json({ symbol, price })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch price' }, { status: 500 })
  }
}
