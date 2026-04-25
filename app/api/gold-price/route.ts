import { NextResponse } from 'next/server'

// Fetches gold price in INR/gram via Yahoo Finance:
//   GC=F  — COMEX gold futures (USD per troy oz)
//   USDINR=X — USD/INR spot rate
// 1 troy oz = 31.1035 g → pricePerGram = (usd_per_oz / 31.1035) × usdinr
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart'

async function fetchPrice(symbol: string): Promise<number> {
  const res = await fetch(`${YF}/${symbol}?interval=1d&range=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 3600 },
  })
  if (!res.ok) throw new Error(`Yahoo Finance ${symbol} ${res.status}`)
  const json = await res.json()
  const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice
  if (!price) throw new Error(`no price for ${symbol}`)
  return price
}

export async function GET() {
  try {
    const [usdPerOz, usdInr] = await Promise.all([
      fetchPrice('GC=F'),
      fetchPrice('USDINR=X'),
    ])
    const pricePerGram = (usdPerOz / 31.1035) * usdInr
    return NextResponse.json({ pricePerGram, usdPerOz, usdInr, source: 'Yahoo Finance GC=F' })
  } catch (err) {
    return NextResponse.json(
      { error: String(err), pricePerGram: null },
      { status: 502 }
    )
  }
}
