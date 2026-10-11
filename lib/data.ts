// Server-side data fetching helpers (used in Server Components only)
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createSupabaseServerClient } from './supabase-server'
import { createSupabaseServiceClient } from './supabase-service'
import { GOLD_PRICE_KEY, type StockPriceInfo } from './stock-prices'
import type { FiscalYear, StockAllocation, Transaction, FYTxn, BuyBand, BuyTranche, Investability, DividendTransaction, BuyBandSnapshot } from './types'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, PPFBalanceOverride, EPFTransaction } from './portfolio-types'
import { USDINR_PRICE_KEY, type FxRate } from './fx'
import { getStocks } from './stock-master'
import { inrPerUnit } from './trade-fx'

// cache()         — deduplicates within a single request (per-render)
// unstable_cache  — persists across requests in the Next.js Data Cache
//
// Caching policy:
//   getFiscalYears  : 1 hour   — changes only when user creates/edits a plan
//   getBuyBands     : 5 min    — on-demand revalidated via revalidateTag('buy_bands') on generate
//   getBuyTranches  : 2 min    — on-demand revalidated via revalidateTag('buy_tranches') on generate
//   getTransactions / getTransactionsBySymbol : 1 hour — all writes go through
//     server actions in app/actions.ts which revalidateTag('transactions')
//   getMFFunds / getMFTransactions : 1 hour — writes go through app/portfolio/actions.ts
//     (revalidateTag('mf_funds' / 'mf_transactions')); the client-side edit/delete paths in
//     TransactionsClient.tsx call revalidateMFTransactions() right after writing, PlanClient-style
//   getSGBTransactions / getPPFTransactions / getPPFOverride / getEPFTransactions : 1 hour —
//     same pattern as MF: writes go through app/portfolio/actions.ts (revalidateTag), and
//     TransactionsClient.tsx's client-side edit/delete paths call the matching revalidate*() action
//   getFxRates / getUsdInrRate : no cache on purpose (fx_rates is written by the Prices refresh route)
//   getMFNavs / getStockPrices / getGoldPrice : no cache on purpose — a Prices-button refresh must show on the next render
//   everything else : no cross-request cache — mutated client-side without server invalidation paths

export { getCurrentFY } from './fy-utils'

export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServerClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user.id ?? null
})

/** Per-request dedupe + signed-out guard: `fn` runs with the user id, or the caller gets `fallback`. */
function userScoped<A extends unknown[], R>(fallback: R, fn: (userId: string, ...args: A) => Promise<R>) {
  return cache(async (...args: A): Promise<R> => {
    const userId = await getUserId()
    if (!userId) return Array.isArray(fallback) ? ([...fallback] as R) : fallback
    return fn(userId, ...args)
  })
}

interface CacheSpec { key: string[]; tags: string[]; revalidate: number }

/** `userScoped` over a cross-request Data Cache entry. `key` must change with the row shape — unstable_cache keys ignore the query. */
function cachedUserScoped<A extends unknown[], R>(spec: CacheSpec, fallback: R, fn: (userId: string, ...args: A) => Promise<R>) {
  return userScoped(fallback, unstable_cache(fn, spec.key, { revalidate: spec.revalidate, tags: spec.tags }))
}

export const getFiscalYears = cachedUserScoped(
  { key: ['fiscal_years'], tags: ['fiscal_years'], revalidate: 3600 },
  [],
  async (userId: string): Promise<FiscalYear[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('fiscal_years')
      .select('id, label, start_date, end_date, total_budget_inr, unallocated_carryover_inr, deploy_capital_inr')
      .eq('user_id', userId)
      .order('start_date', { ascending: true })
    return data ?? []
  }
)

export const getAllocations = userScoped(
  [],
  async (userId: string, fyId: string): Promise<StockAllocation[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('stock_allocations')
      .select('id, fy_id, symbol, exchange, allocation_pct, category')
      .eq('user_id', userId)
      .eq('fy_id', fyId)
      .order('allocation_pct', { ascending: false })
    return data ?? []
  }
)

/** A FY's plan rows, largest first, with display names from the `stocks` master — the Plan screen's list. */
export async function getPlanAllocations(fyId: string): Promise<StockAllocation[]> {
  const allocations = await getAllocations(fyId)
  const stocks = await getStocks(allocations.map(a => a.symbol))
  return allocations.map(a => ({ ...a, allocation_pct: Number(a.allocation_pct), name: stocks[a.symbol]?.name || undefined }))
}

export const getTransactions = cachedUserScoped(
  { key: ['transactions', 'fx_rate'], tags: ['transactions'], revalidate: 3600 },
  [],
  async (userId: string, fyId?: string): Promise<Transaction[]> => {
    const q = createSupabaseServiceClient()
      .from('transactions')
      .select('id, symbol, exchange, trade_date, trade_type, quantity, price, fx_rate, amount, fy_id, notes, created_at')
      .eq('user_id', userId)
      .order('trade_date', { ascending: false })
      .order('created_at', { ascending: false })
    const { data } = fyId
      ? await q.eq('fy_id', fyId)
      : await q
    return data ?? []
  }
)

export const getTransactionsBySymbol = cachedUserScoped(
  { key: ['transactions_by_symbol', 'fx_rate'], tags: ['transactions'], revalidate: 3600 },
  [],
  async (userId: string, symbol: string): Promise<Transaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('transactions')
      .select('id, symbol, exchange, trade_date, trade_type, quantity, price, fx_rate, amount, fy_id, notes')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('trade_date', { ascending: false })
    return data ?? []
  }
)

export const getSymbolAllocations = userScoped(
  [],
  async (userId: string, symbol: string): Promise<StockAllocation[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('stock_allocations')
      .select('id, fy_id, symbol, exchange, allocation_pct, category')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('fy_id', { ascending: true })
    return data ?? []
  }
)

/** Every symbol ever given an allocation, across all fiscal years — the Add-transaction
 * picker's stock chips (root layout → BottomNav → AddTxnModal, and the /add shortcut page).
 * Not scoped to current holdings: a symbol stays listed until removed from whichever FY plan
 * it was added to, even if fully sold. */
export const getAllStockSymbols = userScoped(
  [],
  async (userId: string): Promise<string[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('stock_allocations')
      .select('symbol')
      .eq('user_id', userId)
    return [...new Set((data ?? []).map(a => a.symbol))].sort()
  }
)

export const getBuyBands = cachedUserScoped(
  { key: ['buy_bands'], tags: ['buy_bands'], revalidate: 300 },
  [],
  async (userId: string): Promise<BuyBand[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('buy_bands')
      .select('id, symbol, anchor_type, eps, pat_now, pat_3yr_ago, roce_3yr_avg, mcap, index_level, index_pe, buy_low, buy_high, mid_low, mid_high, trim_price, cmp, week_52_low, week_52_high, last_updated_at, generated_at, is_current, notes, risk_multiplier')
      .eq('user_id', userId)
      .order('generated_at', { ascending: false })
    return data ?? []
  }
)

export const getMFFunds = cachedUserScoped(
  { key: ['mf_funds'], tags: ['mf_funds'], revalidate: 3600 },
  [],
  async (userId: string): Promise<MFund[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('mf_funds')
      .select('id, scheme_code, scheme_name, scheme_type')
      .eq('user_id', userId)
      .order('scheme_name')
    return (data ?? []) as MFund[]
  }
)

export const getMFTransactions = cachedUserScoped(
  { key: ['mf_transactions'], tags: ['mf_transactions'], revalidate: 3600 },
  [],
  async (userId: string): Promise<MFTransaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('mf_transactions')
      .select('id, fund_id, trade_date, trade_type, units, nav, amount')
      .eq('user_id', userId)
      .order('trade_date', { ascending: true })
      .order('trade_type', { ascending: true })
    return (data ?? []) as MFTransaction[]
  }
)

export interface MFNavInfo {
  nav: number
  prevNav: number | null
  navDate: string
}

/**
 * Latest + previous NAV per scheme, from `mf_navs` (written only by syncMfNav, which the
 * Prices button's refresh route calls — progress log #120.c). Public market data, not
 * user-scoped, so no user_id filter. Deliberately uncached, same reasoning as
 * getStockPrices: a refresh must show on the very next render. `prevNav` is already
 * null-guarded at write time (stuck-feed gaps never reach it), so this only maps columns.
 * Schemes with no saved row are simply absent from the result.
 */
export async function getMFNavs(schemeCodes: string[]): Promise<Record<string, MFNavInfo>> {
  if (schemeCodes.length === 0) return {}

  const { data } = await createSupabaseServiceClient()
    .from('mf_navs')
    .select('scheme_code, nav, prev_nav, nav_date')
    .in('scheme_code', schemeCodes)

  const result: Record<string, MFNavInfo> = {}
  for (const row of (data ?? []) as { scheme_code: string; nav: number | string; prev_nav: number | string | null; nav_date: string }[]) {
    result[row.scheme_code] = {
      nav: Number(row.nav),
      prevNav: row.prev_nav === null ? null : Number(row.prev_nav),
      navDate: row.nav_date,
    }
  }
  return result
}

/**
 * Last-saved price per symbol, from `stock_prices` (written only by
 * POST /api/portfolio/prices/refresh — progress log #120.a). Public market data, not
 * user-scoped, so no user_id filter. Deliberately uncached, same reasoning as
 * getMFNavs: a refresh must show on the very next render. Symbols with no
 * saved row are simply absent from the result — callers fall back via resolveCmp.
 */
export async function getStockPrices(symbols: string[]): Promise<Record<string, StockPriceInfo>> {
  if (symbols.length === 0) return {}

  const { data } = await createSupabaseServiceClient()
    .from('stock_prices')
    .select('symbol, cmp, prev_close, fetched_at')
    .in('symbol', symbols)

  const result: Record<string, StockPriceInfo> = {}
  for (const row of (data ?? []) as { symbol: string; cmp: number; prev_close: number | null; fetched_at: string }[]) {
    result[row.symbol] = {
      cmp: Number(row.cmp),
      prevClose: row.prev_close === null ? null : Number(row.prev_close),
      fetchedAt: row.fetched_at,
    }
  }
  return result
}

/** Saved gold price (INR per gram; `prevClose` = prior per-gram) or null if never fetched. Uncached, like getStockPrices. */
export async function getGoldPrice(): Promise<StockPriceInfo | null> {
  return (await getStockPrices([GOLD_PRICE_KEY]))[GOLD_PRICE_KEY] ?? null
}

export const getSGBTransactions = cachedUserScoped(
  { key: ['sgb_transactions'], tags: ['sgb_transactions'], revalidate: 3600 },
  [],
  async (userId: string): Promise<SGBTransaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('sgb_transactions')
      .select('id, trade_date, trade_type, grams, price_per_gram, amount, maturity_date, gold_type, name')
      .eq('user_id', userId)
      .order('trade_date', { ascending: true })
    return (data ?? []) as SGBTransaction[]
  }
)

export const getPPFTransactions = cachedUserScoped(
  { key: ['ppf_transactions'], tags: ['ppf_transactions'], revalidate: 3600 },
  [],
  async (userId: string): Promise<PPFTransaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('ppf_transactions')
      .select('id, trade_date, trade_type, amount, notes')
      .eq('user_id', userId)
      .order('trade_date', { ascending: true })
    return (data ?? []) as PPFTransaction[]
  }
)

export const getPPFOverride = cachedUserScoped(
  { key: ['ppf_balance_override'], tags: ['ppf_balance_override'], revalidate: 3600 },
  null,
  async (userId: string): Promise<PPFBalanceOverride | null> => {
    const { data } = await createSupabaseServiceClient()
      .from('ppf_balance_override')
      .select('id, balance, as_of_date')
      .eq('user_id', userId)
      .limit(1)
    return (data?.[0] ?? null) as PPFBalanceOverride | null
  }
)

export const getEPFTransactions = cachedUserScoped(
  { key: ['epf_transactions', 'wage_month'], tags: ['epf_transactions'], revalidate: 3600 },
  [],
  async (userId: string): Promise<EPFTransaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('epf_transactions')
      .select('id, trade_date, wage_month, trade_type, amount, notes')
      .eq('user_id', userId)
      .order('trade_date', { ascending: true })
    return (data ?? []) as EPFTransaction[]
  }
)

export const getBuyTranches = cachedUserScoped(
  { key: ['buy_tranches'], tags: ['buy_tranches'], revalidate: 120 },
  [],
  async (userId: string, fyId: string): Promise<BuyTranche[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('buy_tranches')
      .select('id, symbol, qty, price, sort_order, fy_id, created_at')
      .eq('user_id', userId)
      .eq('fy_id', fyId)
      .order('symbol')
      .order('sort_order')
    return data ?? []
  }
)


export const getAIKeyStatus = userScoped(
  { hasKey: false },
  async (userId: string): Promise<{ hasKey: boolean }> => {
    const { data } = await createSupabaseServiceClient()
      .from('user_settings')
      .select('gemini_api_key')
      .eq('user_id', userId)
      .maybeSingle()
    return { hasKey: !!data?.gemini_api_key }
  }
)

export const getInvestability = userScoped(
  [],
  async (userId: string, symbols: string[]): Promise<Pick<Investability, 'symbol' | 'investable' | 'total_score'>[]> => {
    if (symbols.length === 0) return []
    const { data } = await createSupabaseServiceClient()
      .from('investability')
      .select('symbol, investable, total_score')
      .eq('user_id', userId)
      .in('symbol', symbols)
    return data ?? []
  }
)

export const getInvestabilityForSymbol = userScoped(
  null,
  async (userId: string, symbol: string): Promise<Investability | null> => {
    const { data } = await createSupabaseServiceClient()
      .from('investability')
      .select('id, symbol, assessed_at, g1_moat, g2_owner_earnings, g3_capital_efficiency, g4_innovation, g5_execution_track, g6_sector_winds, g7_governance, g8_supply_regulatory, g9_market_cap, g10_capital_discipline, total_score, investable, notes, rationale')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .maybeSingle()
    return data ?? null
  }
)

export const getDividendsForSymbol = cachedUserScoped(
  { key: ['dividend_transactions'], tags: ['dividend_transactions'], revalidate: 300 },
  [],
  async (userId: string, symbol: string): Promise<DividendTransaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('dividend_transactions')
      .select('id, symbol, exchange, ex_date, per_share, shares, amount, created_at')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('ex_date', { ascending: false })
    return data ?? []
  }
)

export const getAllDividends = cachedUserScoped(
  { key: ['dividend_transactions_all'], tags: ['dividend_transactions'], revalidate: 300 },
  [],
  async (userId: string): Promise<DividendTransaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('dividend_transactions')
      .select('id, symbol, exchange, ex_date, per_share, shares, amount, created_at')
      .eq('user_id', userId)
      .order('ex_date', { ascending: false })
    return data ?? []
  }
)


export const getLatestSnapshot = cachedUserScoped(
  { key: ['buy_band_snapshots'], tags: ['buy_band_snapshots'], revalidate: 300 },
  null,
  async (userId: string, symbol: string): Promise<BuyBandSnapshot | null> => {
    const { data } = await createSupabaseServiceClient()
      .from('buy_band_snapshots')
      .select('id, symbol, pat_now, pat_3yr_ago, op_profit_cr, revenue_cr, g_computed, op_margin, label, snapshotted_at')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('snapshotted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data ?? null
  }
)

export const getLatestSnapshots = cachedUserScoped(
  { key: ['buy_band_snapshots_two'], tags: ['buy_band_snapshots'], revalidate: 300 },
  [],
  async (userId: string, symbol: string): Promise<BuyBandSnapshot[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('buy_band_snapshots')
      .select('id, symbol, pat_now, pat_3yr_ago, op_profit_cr, revenue_cr, g_computed, op_margin, label, snapshotted_at')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('snapshotted_at', { ascending: false })
      .limit(2)
    return data ?? []
  }
)

/** USD->INR daily history from `fx_rates` (public market data, no user filter). Pair with rateOnOrBefore. Uncached. */
export async function getFxRates(): Promise<FxRate[]> {
  const { data } = await createSupabaseServiceClient()
    .from('fx_rates')
    .select('rate_date, rate')
    .eq('currency', 'USD')
    .order('rate_date', { ascending: true })
  return ((data ?? []) as { rate_date: string; rate: number | string }[]).map(r => ({ rate_date: r.rate_date, rate: Number(r.rate) }))
}

/** INR per unit of each symbol's quote currency (`inrPerUnit`), for the currency-correct P&L in `computeStockRows`. */
export async function getInrPerUnit(symbols: string[]): Promise<Record<string, number | null>> {
  const [stocks, usdInr] = await Promise.all([getStocks(symbols), getUsdInrRate()])
  return inrPerUnit(stocks, usdInr?.cmp ?? null)
}

/** Today's saved USD->INR rate (`prevClose` = prior close) or null if never fetched. Uncached, like getGoldPrice. */
export async function getUsdInrRate(): Promise<StockPriceInfo | null> {
  return (await getStockPrices([USDINR_PRICE_KEY]))[USDINR_PRICE_KEY] ?? null
}
