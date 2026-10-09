import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { getStockPrices } from '@/lib/data'
import { syncMfNav } from '@/lib/mf-nav-sync'
import { fetchCmpBatch, fetchGoldPrice, fetchYahooQuote, fetchUsdInrHistory } from '@/lib/market-data'
import { USDINR_PRICE_KEY } from '@/lib/fx'
import { heldSymbols, buildPriceUpdate, GOLD_PRICE_KEY, usPriceKey, isValidYahooSymbol } from '@/lib/stock-prices'

// The Portfolio "Prices" button's server half (progress log #120): fetch the latest
// prices, compare against what's saved, upsert into stock_prices, and report what moved.
// This is the only writer of stock_prices. It takes no body — symbols come from the
// caller's own holdings and prices come from Yahoo, so nothing client-supplied ever
// reaches a table every user reads. Gold rides along as one more row under GOLD_PRICE_KEY,
// fetched only when the caller has gold transactions. MF NAVs (mf_navs) are synced from AMFI
// in the same call, only when the caller has any mf_funds; a failed AMFI sync is logged and
// never fails the price save, and the response carries no NAV figures (progress log #120.c).
// US holdings (#131.a) ride along when the caller has any: each holding's Yahoo symbol and USD->INR
// (under USDINR_PRICE_KEY; quotes under usPriceKey, a `US:` namespace so a user-entered symbol can't collide with an NSE or reserved key) go into stock_prices, and the daily USD->INR history is upserted into
// fx_rates — a full backfill the first time or when a trade predates it, else just the last month.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createSupabaseServiceClient()

  const [
    { data: txns, error: txnError },
    { data: goldTxns, error: goldTxnError },
    { data: mfFundRows, error: mfFundError },
    { data: usHoldings, error: usHoldingError },
    { data: usTxnDates, error: usTxnError },
    { data: fxFirst, error: fxError },
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
    service
      .from('us_holdings')
      .select('yahoo_symbol')
      .eq('user_id', user.id),
    service
      .from('us_transactions')
      .select('trade_date')
      .eq('user_id', user.id)
      .order('trade_date', { ascending: true })
      .limit(1),
    service
      .from('fx_rates')
      .select('rate_date')
      .eq('currency', 'USD')
      .order('rate_date', { ascending: true })
      .limit(1),
  ])
  if (txnError) return NextResponse.json({ error: txnError.message }, { status: 500 })
  if (goldTxnError) return NextResponse.json({ error: goldTxnError.message }, { status: 500 })
  if (mfFundError) return NextResponse.json({ error: mfFundError.message }, { status: 500 })
  if (usHoldingError) return NextResponse.json({ error: usHoldingError.message }, { status: 500 })
  if (usTxnError) return NextResponse.json({ error: usTxnError.message }, { status: 500 })
  if (fxError) return NextResponse.json({ error: fxError.message }, { status: 500 })

  const symbols = heldSymbols(txns ?? [])
  const holdsGold = (goldTxns ?? []).length > 0
  const holdsMf = (mfFundRows ?? []).length > 0
  const usSymbols = [...new Set((usHoldings ?? []).map(h => h.yahoo_symbol as string).filter(isValidYahooSymbol))]
  const holdsUs = usSymbols.length > 0
  const firstTrade = usTxnDates?.[0]?.trade_date as string | undefined
  const firstFx = fxFirst?.[0]?.rate_date as string | undefined
  const fxRange = !firstFx || (firstTrade && firstTrade < firstFx) ? 'max' : '1mo'

  // The AMFI sync runs alongside the Yahoo fetches so it adds no serial latency, and is awaited
  // here so the client's router.refresh() after this response reads the new NAVs.
  const [previous, batch, goldQuote, usQuotes, fxHistory] = await Promise.all([
    getStockPrices(symbols),
    symbols.length > 0 ? fetchCmpBatch(symbols) : Promise.resolve({ prices: {}, prevClose: {} }),
    holdsGold ? fetchGoldPrice() : Promise.resolve(null),
    holdsUs ? Promise.all(usSymbols.map(sym => fetchYahooQuote(sym).then(q => ({ sym, q })))) : Promise.resolve([]),
    holdsUs ? fetchUsdInrHistory(fxRange) : Promise.resolve([]),
    holdsMf ? syncMfNav(service).catch(err => console.error('MF NAV sync failed', err)) : Promise.resolve(),
  ])

  const fetchedAt = new Date().toISOString()
  const { rows, moved, failed } = buildPriceUpdate(symbols, batch, previous, fetchedAt)

  // Like a failed stock symbol, a failed gold fetch gets no row — the saved price stays.
  const gold: 'skipped' | 'updated' | 'failed' = !holdsGold ? 'skipped' : goldQuote ? 'updated' : 'failed'
  const upserts: { symbol: string; cmp: number; prev_close: number | null; fetched_at: string }[] = goldQuote
    ? [...rows, { symbol: GOLD_PRICE_KEY, cmp: goldQuote.pricePerGram, prev_close: goldQuote.prevPricePerGram, fetched_at: fetchedAt }]
    : rows

  // A failed US quote or FX fetch gets no row, like stocks and gold — the saved value stays.
  const usRows = usQuotes.flatMap(({ sym, q }) =>
    q ? [{ symbol: usPriceKey(sym), cmp: q.price, prev_close: q.previousClose, fetched_at: fetchedAt }] : [])
  const usQuotesUpdated = usRows.length
  const latestFx = fxHistory[fxHistory.length - 1]
  const prevFx = fxHistory[fxHistory.length - 2]
  const fx: 'skipped' | 'updated' | 'failed' = !holdsUs ? 'skipped' : latestFx ? 'updated' : 'failed'
  if (latestFx) {
    usRows.push({ symbol: USDINR_PRICE_KEY, cmp: latestFx.rate, prev_close: prevFx?.rate ?? null, fetched_at: fetchedAt })
  }
  upserts.push(...usRows)
  if (fxHistory.length > 0) {
    const { error } = await service
      .from('fx_rates')
      .upsert(fxHistory.map(r => ({ currency: 'USD', ...r })), { onConflict: 'currency,rate_date' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (upserts.length > 0) {
    const { error } = await service.from('stock_prices').upsert(upserts, { onConflict: 'symbol' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    fetchedAt,
    stocks: { requested: symbols.length, updated: rows.length, moved: moved.length, failed },
    gold,
    us: { requested: usSymbols.length, updated: usQuotesUpdated, fx },
  })
}
