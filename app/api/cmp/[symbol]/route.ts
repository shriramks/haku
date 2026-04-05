import { NextRequest, NextResponse } from 'next/server'
import { fetchCmpQuote } from '@/lib/market-data'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const quote = await fetchCmpQuote(symbol)
  if (!quote) return NextResponse.json({ error: 'Price not found' }, { status: 404 })
  return NextResponse.json({ symbol, price: quote.price, week52Low: quote.week52Low, week52High: quote.week52High })
}
