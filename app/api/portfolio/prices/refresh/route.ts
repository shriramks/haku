import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { getStockPrices } from '@/lib/data'
import { syncMfNav } from '@/lib/mf-nav-sync'
import { fetchCmpBatch, fetchGoldPrice } from '@/lib/market-data'
import { heldSymbols, buildPriceUpdate, GOLD_PRICE_KEY } from '@/lib/stock-prices'

// The Portfolio "Prices" button's server half (progress log #120): fetch the latest
// prices, compare against what's saved, upsert into stock_prices, and report what moved.
// This is the only writer of stock_prices. It takes no body — symbols come from the
// caller's own holdings and prices come from Yahoo, so nothing client-supplied ever
// reaches a table every user reads. Gold rides along as one more row under GOLD_PRICE_KEY,
// fetched only when the caller has gold transactions. MF NAVs (mf_navs) are synced from AMFI
// in the same call, only when the caller has any mf_funds; a failed AMFI sync is logged and
// never fails the price save, and the response carries no NAV figures (progress log #120.c).
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createSupabaseServiceClient()

  const [
    { data: txns, error: txnError },
    { data: goldTxns, error: goldTxnError },
    { data: mfFundRows, error: mfFundError },
  ] = await Promise.all([
    service
      .from('transactions')
      .select('symbol, trade_date, trade_type, quantity, amount')
      .eq('user_id', user.id),
    service
      .from('sgb_transactions')
      .select('id')
      .eq('user_id', user.id)
      .limit(1),
    service
      .from('mf_funds')
      .select('id')
      .eq('user_id', user.id)
      .limit(1),
  ])
  if (txnError) return NextResponse.json({ error: txnError.message }, { status: 500 })
  if (goldTxnError) return NextResponse.json({ error: goldTxnError.message }, { status: 500 })
  if (mfFundError) return NextResponse.json({ error: mfFundError.message }, { status: 500 })

  const symbols = heldSymbols(txns ?? [])
  const holdsGold = (goldTxns ?? []).length > 0
  const holdsMf = (mfFundRows ?? []).length > 0

  // The AMFI sync runs alongside the Yahoo fetches so it adds no serial latency, and is awaited
  // here so the client's router.refresh() after this response reads the new NAVs.
  const [previous, batch, goldQuote] = await Promise.all([
    getStockPrices(symbols),
    symbols.length > 0 ? fetchCmpBatch(symbols) : Promise.resolve({ prices: {}, prevClose: {} }),
    holdsGold ? fetchGoldPrice() : Promise.resolve(null),
    holdsMf ? syncMfNav(service).catch(err => console.error('MF NAV sync failed', err)) : Promise.resolve(),
  ])

  const fetchedAt = new Date().toISOString()
  const { rows, moved, failed } = buildPriceUpdate(symbols, batch, previous, fetchedAt)

  // Like a failed stock symbol, a failed gold fetch gets no row — the saved price stays.
  const gold: 'skipped' | 'updated' | 'failed' = !holdsGold ? 'skipped' : goldQuote ? 'updated' : 'failed'
  const upserts = goldQuote
    ? [...rows, { symbol: GOLD_PRICE_KEY, cmp: goldQuote.pricePerGram, prev_close: goldQuote.prevPricePerGram, fetched_at: fetchedAt }]
    : rows

  if (upserts.length > 0) {
    const { error } = await service.from('stock_prices').upsert(upserts, { onConflict: 'symbol' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    fetchedAt,
    stocks: { requested: symbols.length, updated: rows.length, moved: moved.length, failed },
    gold,
  })
}
