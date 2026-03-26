import { NextRequest, NextResponse } from 'next/server'
import { fetchCmp } from '@/lib/market-data'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const price = await fetchCmp(symbol)
  if (!price) return NextResponse.json({ error: 'Price not found' }, { status: 404 })
  return NextResponse.json({ symbol, price })
}
