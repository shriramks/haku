import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { getStockPrices } from '@/lib/data'
import { fetchCmpBatch } from '@/lib/market-data'
import { heldSymbols, buildPriceUpdate } from '@/lib/stock-prices'

// The Portfolio "Prices" button's server half (progress log #120): fetch the latest
// prices, compare against what's saved, upsert into stock_prices, and report what moved.
// This is the only writer of stock_prices. It takes no body — symbols come from the
// caller's own holdings and prices come from Yahoo, so nothing client-supplied ever
// reaches a table every user reads.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createSupabaseServiceClient()

  const { data: txns, error: txnError } = await service
    .from('transactions')
    .select('symbol, trade_date, trade_type, quantity, amount')
    .eq('user_id', user.id)
  if (txnError) return NextResponse.json({ error: txnError.message }, { status: 500 })

  const symbols = heldSymbols(txns ?? [])

  const [previous, batch] = await Promise.all([
    getStockPrices(symbols),
    symbols.length > 0 ? fetchCmpBatch(symbols) : Promise.resolve({ prices: {}, prevClose: {} }),
  ])

  const fetchedAt = new Date().toISOString()
  const { rows, moved, failed } = buildPriceUpdate(symbols, batch, previous, fetchedAt)

  if (rows.length > 0) {
    const { error } = await service.from('stock_prices').upsert(rows, { onConflict: 'symbol' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    fetchedAt,
    stocks: { requested: symbols.length, updated: rows.length, moved: moved.length, failed },
  })
}
