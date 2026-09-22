import { NextResponse } from 'next/server'

// Fetches gold price in INR/gram via Yahoo Finance:
//   GC=F  — COMEX gold futures (USD per troy oz)
//   USDINR=X — USD/INR spot rate
// 1 troy oz = 31.1035 g → pricePerGram = (usd_per_oz / 31.1035) × usdinr
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart'

interface PriceMeta {
  price: number
  prevClose: number | null
}

async function fetchPrice(symbol: string): Promise<PriceMeta> {
  const res = await fetch(`${YF}/${symbol}?interval=1d&range=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 3600 },
  })
  if (!res.ok) throw new Error(`Yahoo Finance ${symbol} ${res.status}`)
  const json = await res.json()
  const meta = json?.chart?.result?.[0]?.meta
  const price = meta?.regularMarketPrice
  if (!price) throw new Error(`no price for ${symbol}`)
  // Futures/FX chart meta carries the prior close as chartPreviousClose, not
  // previousClose (unlike NSE equities — see lib/market-data.ts).
  return { price, prevClose: (meta?.chartPreviousClose as number) ?? null }
}

export async function GET() {
  try {
    const [gc, usdinr] = await Promise.all([
      fetchPrice('GC=F'),
      fetchPrice('USDINR=X'),
    ])
    const usdPerOz = gc.price
    const usdInr = usdinr.price
    const pricePerGram = (usdPerOz / 31.1035) * usdInr
    const prevPricePerGram = gc.prevClose !== null && usdinr.prevClose !== null
      ? (gc.prevClose / 31.1035) * usdinr.prevClose
      : null
    return NextResponse.json({ pricePerGram, prevPricePerGram, usdPerOz, usdInr, source: 'Yahoo Finance GC=F' })
  } catch (err) {
    return NextResponse.json(
      { error: String(err), pricePerGram: null },
      { status: 502 }
    )
  }
}
