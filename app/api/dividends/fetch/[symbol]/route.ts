import { NextRequest, NextResponse } from 'next/server'
import { fetchNseDividends } from '@/lib/nse'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  try {
    const dividends = await fetchNseDividends(symbol)
    return NextResponse.json(dividends)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
