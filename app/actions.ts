'use server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { getUserId, getPlanAllocations, getTransactions, getLatestSnapshot } from '@/lib/data'
import { fyIdForDate } from '@/lib/fy-utils'
import { refreshStockPrices as refreshStockPricesImpl, type RefreshedStockPrices } from '@/lib/stock-price-refresh'
import { netDeployed } from '@/lib/compute'
import { ensureStocks, getStocks, type Stock } from '@/lib/stock-master'
import { fetchYahooInstrument } from '@/lib/market-data'
import { isValidYahooSymbol } from '@/lib/instrument'
import { tradeFxRate } from '@/lib/trade-fx'
import { isValidStockSymbol } from '@/lib/stock-master'
import type { StockAllocation, Transaction, FYTxn, DividendTransaction, BuyBandSnapshot } from '@/lib/types'

export async function revalidateFiscalYears() {
  revalidateTag('fiscal_years', {})
}

/** stock_allocations is uncached server-side and written from the browser (PlanClient),
 * so there's no tag to bust — but the client router cache (staleTimes) would otherwise
 * serve the old Allocation/Bands pages for up to 30s. revalidatePath purges it. */
export async function revalidateAllocations() {
  revalidatePath('/', 'layout')
}

export async function revalidateBuyBands() {
  revalidateTag('buy_bands', {})
}

/** Bands "Refresh CMP": fetches the symbols' latest prices server-side and saves them to
 * stock_prices (#151). stock_prices is uncached; revalidatePath purges the client router
 * cache so Portfolio / stock detail show the new price on the next visit. */
export async function refreshStockPrices(symbols: string[]): Promise<RefreshedStockPrices | null> {
  const result = await refreshStockPricesImpl(symbols)
  if (result) revalidatePath('/', 'layout')
  return result
}

export interface InstrumentLookup {
  yahooSymbol: string
  name: string
  exchange: string
  currency: string
  price: number
}

/** Quote-confirms an overseas ticker. Only USD quotes are supported: the trade-date rate table is USD->INR. */
async function confirmOverseas(yahooSymbol: string): Promise<{ instrument: InstrumentLookup | null; error: string | null }> {
  const symbol = yahooSymbol.trim().toUpperCase()
  if (!isValidYahooSymbol(symbol)) return { instrument: null, error: 'No quote found' }
  const q = await fetchYahooInstrument(symbol)
  if (!q) return { instrument: null, error: 'No quote found' }
  if (q.currency !== 'USD') return { instrument: null, error: `${q.currency} quotes are not supported` }
  return { instrument: { yahooSymbol: symbol, name: q.name, exchange: q.exchange.toUpperCase() || 'OTHER', currency: q.currency, price: q.price }, error: null }
}

/** Add Stock "Other": what Yahoo says this ticker is (name, venue, currency, last price). Writes nothing. */
export async function lookupInstrument(yahooSymbol: string): Promise<{ instrument: InstrumentLookup | null; error: string | null }> {
  if (!(await getUserId())) return { instrument: null, error: 'Not signed in' }
  return confirmOverseas(yahooSymbol)
}

/**
 * Creates the shared `stocks` master row for an overseas instrument added in Plan. The venue,
 * currency and name come from a fresh server-side Yahoo quote, never from the client, because the
 * master is read by every user, and the symbol must equal the ticker's base and not be an NSE listing.
 * An existing row is never overwritten: a symbol already mapped to a different ticker is an error. Returns the venue to store on the plan row.
 */
export async function registerInstrument(
  symbol: string,
  yahooSymbol: string,
): Promise<{ exchange: string | null; name: string; error: string | null }> {
  if (!(await getUserId())) return { exchange: null, name: '', error: 'Not signed in' }
  const sym = symbol.trim().toUpperCase()
  if (!isValidStockSymbol(sym)) return { exchange: null, name: '', error: 'Invalid symbol' }
  const { instrument, error } = await confirmOverseas(yahooSymbol)
  if (!instrument) return { exchange: null, name: '', error }
  // The master is shared by every user, so the app symbol must be the ticker itself (VUAA <- VUAA.L),
  // and must not be a symbol that already resolves as an NSE listing: either would let one user point
  // another user's symbol at a different instrument's price.
  if (instrument.yahooSymbol.split('.')[0] !== sym) {
    return { exchange: null, name: '', error: `Symbol must be ${instrument.yahooSymbol.split('.')[0]}` }
  }
  if (await fetchYahooInstrument(`${sym}.NS`)) return { exchange: null, name: '', error: `${sym} is an Indian listing` }
  const stock: Stock = {
    symbol: sym, exchange: instrument.exchange, currency: instrument.currency,
    yahooSymbol: instrument.yahooSymbol, region: 'us', name: instrument.name,
  }
  const master = await ensureStocks([sym], { [sym]: stock })
  const row = master?.[sym]
  if (!row) return { exchange: null, name: '', error: 'Could not save the instrument' }
  if (row.yahooSymbol.toUpperCase() !== instrument.yahooSymbol) {
    return { exchange: null, name: '', error: `${sym} is already set up as ${row.yahooSymbol}` }
  }
  return { exchange: row.exchange, name: row.name, error: null }
}

export async function revalidateBuyTranches() {
  revalidateTag('buy_tranches', {})
}

/** Fetch allocations for a FY — used by PlanClient on FY switch */
export async function getAllocationsForFY(fyId: string): Promise<StockAllocation[]> {
  return getPlanAllocations(fyId)
}

/** Returns true if the FY has any transactions — used to decide delete vs reset */
export async function checkFYHasTxns(fyId: string): Promise<boolean> {
  const userId = await getUserId()
  if (!userId) return false
  const { count } = await createSupabaseServiceClient()
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('fy_id', fyId)
  return (count ?? 0) > 0
}

/**
 * Computes carryover from a previous FY: pool (budget + its own carryover) minus
 * net deployed (all buys minus all sell proceeds; every instrument's `amount` is INR). Can be negative if over-invested.
 */
export async function getPrevFYCarryover(prevFYId: string, prevFYPool: number): Promise<number> {
  const userId = await getUserId()
  if (!userId) return 0
  const { data } = await createSupabaseServiceClient()
    .from('transactions')
    .select('trade_type, amount')
    .eq('user_id', userId)
    .eq('fy_id', prevFYId)
  return prevFYPool - netDeployed((data ?? []) as Pick<FYTxn, 'trade_type' | 'amount'>[])
}

/** Returns true if any current buy bands exist — used for onboarding step */
export async function hasBands(): Promise<boolean> {
  const userId = await getUserId()
  if (!userId) return false
  const { count } = await createSupabaseServiceClient()
    .from('buy_bands')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  return (count ?? 0) > 0
}

/** Fetches all stock transactions (all FYs) — used by TransactionsClient to expand history beyond the initial current-FY slice. Hits the unstable_cache so it's fast when warm. */
export async function loadAllStockTransactions(): Promise<Transaction[]> {
  return getTransactions()
}

/** Fetches allocations + transactions for a FY — used by DashboardClient switchFY */
export async function getFYData(fyId: string): Promise<{
  allocations: StockAllocation[]
  transactions: FYTxn[]
}> {
  const [allocations, transactions] = await Promise.all([
    getPlanAllocations(fyId),
    getTransactions(fyId),
  ])
  return { allocations, transactions }
}

/** Batch-upserts dividend rows (keyed on user_id + symbol + ex_date) */
export async function saveDividends(
  rows: Pick<DividendTransaction, 'symbol' | 'exchange' | 'ex_date' | 'per_share' | 'shares'>[]
): Promise<void> {
  const userId = await getUserId()
  if (!userId || rows.length === 0) return
  await createSupabaseServiceClient()
    .from('dividend_transactions')
    .upsert(
      rows.map(r => ({ ...r, user_id: userId })),
      { onConflict: 'user_id,symbol,ex_date' }
    )
  revalidateTag('dividend_transactions', {})
}

type SnapFields = Pick<BuyBandSnapshot, 'pat_now' | 'pat_3yr_ago' | 'op_profit_cr' | 'revenue_cr' | 'g_computed' | 'op_margin'>

/** Inserts a snapshot row only when any numeric field differs from the latest stored one */
export async function saveSnapshotIfChanged(
  symbol: string,
  snap: SnapFields,
  label: string | null
): Promise<void> {
  const userId = await getUserId()
  if (!userId) return
  const latest = await getLatestSnapshot(symbol)
  const fields: (keyof SnapFields)[] = ['pat_now', 'pat_3yr_ago', 'op_profit_cr', 'revenue_cr', 'g_computed', 'op_margin']
  const changed = !latest || fields.some(f => snap[f] !== latest[f])
  if (!changed) return
  await createSupabaseServiceClient()
    .from('buy_band_snapshots')
    .insert({ ...snap, user_id: userId, symbol, label })
  revalidateTag('buy_band_snapshots', {})
}

// ── Stock transaction writes ──────────────────────────────────────────────────
// All writes to `transactions` go through these actions so the 'transactions'
// cache tag is invalidated — browser-side writes have no revalidation path.

export interface StockTxnInput {
  symbol: string
  exchange: string
  trade_date: string
  trade_type: 'buy' | 'sell'
  quantity: number
  /** In the instrument's own currency. */
  price: number
  /** INR per unit of the instrument's currency on trade_date. Ignored (stored as 1) for an INR instrument. */
  fx_rate?: number
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** A `transactions` row as written: only these fields, with the rate and venue resolved server-side. */
interface TradeRow {
  symbol: string; exchange: string; trade_date: string; trade_type: 'buy' | 'sell'
  quantity: number; price: number; fx_rate: number
}

/** The fields a client may set on a trade; everything else on the object it sent is ignored. */
function tradeFieldError(t: { trade_date: unknown; quantity: unknown; price: unknown }): string | null {
  if (typeof t.trade_date !== 'string' || !ISO_DATE.test(t.trade_date)) return 'Invalid date'
  if (!positive(t.quantity) || !positive(t.price)) return 'Enter quantity and price'
  return null
}

/** Inserts a stock transaction; fy_id derived from trade_date. Returns the fy_id for follow-up actions (e.g. redeploy). */
export async function addStockTransaction(
  input: StockTxnInput
): Promise<{ fyId: string | null; error: string | null }> {
  const userId = await getUserId()
  if (!userId) return { fyId: null, error: 'Not signed in' }
  if (!isValidStockSymbol(input.symbol)) return { fyId: null, error: 'Invalid symbol' }
  if (input.trade_type !== 'buy' && input.trade_type !== 'sell') return { fyId: null, error: 'Invalid trade type' }
  const fieldError = tradeFieldError(input)
  if (fieldError) return { fyId: null, error: fieldError }
  const svc = createSupabaseServiceClient()
  // The instrument master is kept in step with what is traded, so the price pull can resolve the symbol.
  const master = await ensureStocks([input.symbol])
  if (!master) return { fyId: null, error: 'Could not save the instrument' }
  const fxRate = tradeFxRate(master[input.symbol], input.fx_rate)
  if (fxRate === null) return { fyId: null, error: 'Enter the rate' }
  const fyId = await fyIdForDate(svc, input.trade_date, userId)
  const { error } = await svc.from('transactions').insert({
    symbol: input.symbol, exchange: master[input.symbol]?.exchange ?? 'NSE',
    trade_date: input.trade_date, trade_type: input.trade_type,
    quantity: input.quantity, price: input.price, fx_rate: fxRate,
    user_id: userId, fy_id: fyId,
  })
  if (error) return { fyId, error: error.message }
  revalidateTag('transactions', {})
  return { fyId, error: null }
}

/** Updates qty/price/date of a stock transaction; fy_id re-derived from the new date. */
export async function updateStockTransaction(
  id: string,
  patch: { quantity: number; price: number; trade_date: string; fx_rate?: number }
): Promise<{ fyId: string | null; error: string | null }> {
  const userId = await getUserId()
  if (!userId) return { fyId: null, error: 'Not signed in' }
  const fieldError = tradeFieldError(patch)
  if (fieldError) return { fyId: null, error: fieldError }
  const svc = createSupabaseServiceClient()
  // The row's own instrument decides whether a rate applies (INR rows stay at 1).
  const { data: row } = await svc.from('transactions').select('symbol').eq('id', id).eq('user_id', userId).single()
  if (!row) return { fyId: null, error: 'Transaction not found' }
  const fxRate = tradeFxRate((await getStocks([row.symbol]))[row.symbol], patch.fx_rate)
  if (fxRate === null) return { fyId: null, error: 'Enter the rate' }
  const fyId = await fyIdForDate(svc, patch.trade_date, userId)
  const { error } = await svc.from('transactions')
    .update({ quantity: patch.quantity, price: patch.price, trade_date: patch.trade_date, fx_rate: fxRate, fy_id: fyId })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) return { fyId, error: error.message }
  revalidateTag('transactions', {})
  return { fyId, error: null }
}

export async function deleteStockTransaction(id: string): Promise<{ error: string | null }> {
  const userId = await getUserId()
  if (!userId) return { error: 'Not signed in' }
  const { error } = await createSupabaseServiceClient()
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) return { error: error.message }
  revalidateTag('transactions', {})
  return { error: null }
}

/**
 * Batch-inserts stock transactions (CSV import). Derives fy_id per unique date,
 * inserts in chunks, and optionally redeploys sell proceeds into each FY's
 * unallocated carryover. One revalidation per tag at the end.
 */
export async function importStockTransactions(
  rows: StockTxnInput[],
  redeploySellProceeds: boolean
): Promise<{ error: string | null }> {
  const userId = await getUserId()
  if (!userId) return { error: 'Not signed in' }
  if (rows.length === 0) return { error: null }
  const svc = createSupabaseServiceClient()

  // Validate every row before any Yahoo / master work or write.
  for (const r of rows) {
    if (!isValidStockSymbol(r.symbol)) return { error: `Invalid symbol ${r.symbol}` }
    if (r.trade_type !== 'buy' && r.trade_type !== 'sell') return { error: 'Invalid trade type' }
    const fieldError = tradeFieldError(r)
    if (fieldError) return { error: fieldError }
  }

  const symbols = [...new Set(rows.map(r => r.symbol))]
  const master = await ensureStocks(symbols)
  if (!master) return { error: 'Could not save the instruments' }
  const withRate: TradeRow[] = []
  for (const r of rows) {
    const fxRate = tradeFxRate(master[r.symbol], r.fx_rate)
    if (fxRate === null) return { error: `Enter the rate for ${r.symbol}` }
    withRate.push({
      symbol: r.symbol, exchange: master[r.symbol]?.exchange ?? 'NSE', trade_date: r.trade_date,
      trade_type: r.trade_type, quantity: r.quantity, price: r.price, fx_rate: fxRate,
    })
  }

  const uniqueDates = [...new Set(rows.map(r => r.trade_date))]
  const fyByDate = new Map<string, string | null>()
  await Promise.all(uniqueDates.map(async d => {
    fyByDate.set(d, await fyIdForDate(svc, d, userId))
  }))

  const inserts = withRate.map(r => ({
    ...r, user_id: userId, fy_id: fyByDate.get(r.trade_date) ?? null,
  }))
  const CHUNK = 500
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await svc.from('transactions').insert(inserts.slice(i, i + CHUNK))
    if (error) return { error: error.message }
  }
  revalidateTag('transactions', {})

  if (redeploySellProceeds) {
    const sellByFy = new Map<string, number>()
    for (const r of withRate) {
      if (r.trade_type !== 'sell') continue
      const fyId = fyByDate.get(r.trade_date)
      if (!fyId) continue
      sellByFy.set(fyId, (sellByFy.get(fyId) ?? 0) + r.quantity * r.price * r.fx_rate)
    }
    for (const [fyId, amount] of sellByFy) {
      const { error } = await addToCarryover(svc, userId, fyId, amount)
      if (error) return { error }
    }
    if (sellByFy.size > 0) revalidateTag('fiscal_years', {})
  }
  return { error: null }
}

/** Adds sell proceeds to a FY's unallocated carryover — used by AddTxnModal redeploy. */
export async function redeployToFY(fyId: string, amount: number): Promise<{ error: string | null }> {
  const userId = await getUserId()
  if (!userId) return { error: 'Not signed in' }
  const { error } = await addToCarryover(createSupabaseServiceClient(), userId, fyId, amount)
  if (error) return { error }
  revalidateTag('fiscal_years', {})
  return { error: null }
}

async function addToCarryover(
  svc: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
  fyId: string,
  amount: number
): Promise<{ error: string | null }> {
  const { data: fy } = await svc.from('fiscal_years')
    .select('unallocated_carryover_inr')
    .eq('id', fyId)
    .eq('user_id', userId)
    .single()
  const { error } = await svc.from('fiscal_years')
    .update({ unallocated_carryover_inr: (fy?.unallocated_carryover_inr ?? 0) + amount })
    .eq('id', fyId)
    .eq('user_id', userId)
  return { error: error?.message ?? null }
}

/** Copies allocations from one FY into another — used by copyFromPrevFY */
export async function copyAllocations(fromFyId: string, toFyId: string): Promise<StockAllocation[]> {
  const userId = await getUserId()
  if (!userId) return []
  const sb = createSupabaseServiceClient()
  const { data: source } = await sb
    .from('stock_allocations')
    .select('symbol, exchange, allocation_pct, category')
    .eq('user_id', userId)
    .eq('fy_id', fromFyId)
  if (!source?.length) return []
  const { data: inserted } = await sb
    .from('stock_allocations')
    .insert(source.map(a => ({
      fy_id: toFyId, user_id: userId,
      symbol: a.symbol, exchange: a.exchange,
      allocation_pct: a.allocation_pct, category: a.category,
    })))
    .select()
  revalidatePath('/', 'layout')
  const stocks = await getStocks((inserted ?? []).map(a => a.symbol))
  return (inserted ?? []).map(a => ({ ...a, name: stocks[a.symbol]?.name || undefined }))
}
