import { NextRequest, NextResponse } from 'next/server'
import { fetchCmpBatch } from '@/lib/market-data'

// Yahoo Finance v7 quote endpoint supports multiple symbols in one request.
// Returns { [symbol]: price } where symbol matches the input (without .NS suffix).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('symbols') ?? ''
  const symbols = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

  if (symbols.length === 0)
    return NextResponse.json({ error: 'symbols param required' }, { status: 400 })

  const { prices, week52 } = await fetchCmpBatch(symbols)
  return NextResponse.json({ prices, week52 })
}
