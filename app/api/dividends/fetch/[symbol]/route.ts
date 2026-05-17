import { NextRequest, NextResponse } from 'next/server'
import { fetchScreenerHtml, parseDividendHistory } from '@/lib/screener'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  try {
    const html = await fetchScreenerHtml(symbol, false)
    const dividends = parseDividendHistory(html)
    return NextResponse.json(dividends)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
