// Server-side data fetching helpers (used in Server Components only)
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createSupabaseServerClient } from './supabase-server'
import { createSupabaseServiceClient } from './supabase-service'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, BuyTranche, Investability, DividendTransaction, BuyBandSnapshot } from './types'

// cache()         — deduplicates within a single request (per-render)
// unstable_cache  — persists across requests in the Next.js Data Cache
//
// Caching policy:
//   getFiscalYears  : 1 hour   — changes only when user creates/edits a plan
//   getBuyBands     : 5 min    — on-demand revalidated via revalidateTag('buy_bands') on generate
//   getBuyTranches  : 2 min    — on-demand revalidated via revalidateTag('buy_tranches') on generate
//   getTransactions / getTransactionsBySymbol : 1 hour — all writes go through
//     server actions in app/actions.ts which revalidateTag('transactions')
//   everything else : no cross-request cache — mutated client-side without server invalidation paths

export { getCurrentFY } from './fy-utils'

export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServerClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user.id ?? null
})

const _fetchFiscalYears = unstable_cache(
  async (userId: string): Promise<FiscalYear[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('fiscal_years')
      .select('id, label, start_date, end_date, total_budget_inr, unallocated_carryover_inr, deploy_capital_inr')
      .eq('user_id', userId)
      .order('start_date', { ascending: true })
    return data ?? []
  },
  ['fiscal_years'],
  { revalidate: 3600, tags: ['fiscal_years'] }
)

export const getFiscalYears = cache(async (): Promise<FiscalYear[]> => {
  const userId = await getUserId()
  if (!userId) return []
  return _fetchFiscalYears(userId)
})

export const getAllocations = cache(async (fyId: string): Promise<StockAllocation[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const { data } = await createSupabaseServiceClient()
    .from('stock_allocations')
    .select('id, fy_id, symbol, exchange, allocation_pct, category')
    .eq('user_id', userId)
    .eq('fy_id', fyId)
    .order('allocation_pct', { ascending: false })
  return data ?? []
})

const _fetchTransactions = unstable_cache(
  async (userId: string, fyId?: string): Promise<Transaction[]> => {
    const q = createSupabaseServiceClient()
      .from('transactions')
      .select('id, symbol, exchange, trade_date, trade_type, quantity, price, amount, fy_id, notes, created_at')
      .eq('user_id', userId)
      .order('trade_date', { ascending: false })
      .order('created_at', { ascending: false })
    const { data } = fyId
      ? await q.eq('fy_id', fyId)
      : await q
    return data ?? []
  },
  ['transactions'],
  { revalidate: 3600, tags: ['transactions'] }
)

export const getTransactions = cache(async (fyId?: string): Promise<Transaction[]> => {
  const userId = await getUserId()
  if (!userId) return []
  return _fetchTransactions(userId, fyId)
})

const _fetchTransactionsBySymbol = unstable_cache(
  async (userId: string, symbol: string): Promise<Transaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('transactions')
      .select('id, symbol, exchange, trade_date, trade_type, quantity, price, amount, fy_id, notes')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('trade_date', { ascending: false })
    return data ?? []
  },
  ['transactions_by_symbol'],
  { revalidate: 3600, tags: ['transactions'] }
)

export const getTransactionsBySymbol = cache(async (symbol: string): Promise<Transaction[]> => {
  const userId = await getUserId()
  if (!userId) return []
  return _fetchTransactionsBySymbol(userId, symbol)
})

export const getSymbolAllocations = cache(async (symbol: string): Promise<StockAllocation[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const { data } = await createSupabaseServiceClient()
    .from('stock_allocations')
    .select('id, fy_id, symbol, exchange, allocation_pct, category')
    .eq('user_id', userId)
    .eq('symbol', symbol)
    .order('fy_id', { ascending: true })
  return data ?? []
})

const _fetchBuyBands = unstable_cache(
  async (userId: string): Promise<BuyBand[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('buy_bands')
      .select('id, symbol, anchor_type, eps, pat_now, pat_3yr_ago, roce_3yr_avg, mcap, index_level, index_pe, buy_low, buy_high, mid_low, mid_high, trim_price, cmp, week_52_low, week_52_high, last_updated_at, generated_at, is_current, notes, risk_multiplier')
      .eq('user_id', userId)
      .order('generated_at', { ascending: false })
    return data ?? []
  },
  ['buy_bands'],
  { revalidate: 300, tags: ['buy_bands'] }
)

export const getBuyBands = cache(async (): Promise<BuyBand[]> => {
  const userId = await getUserId()
  if (!userId) return []
  return _fetchBuyBands(userId)
})


const _fetchBuyTranches = unstable_cache(
  async (userId: string, fyId: string): Promise<BuyTranche[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('buy_tranches')
      .select('id, symbol, qty, price, sort_order, fy_id, created_at')
      .eq('user_id', userId)
      .eq('fy_id', fyId)
      .order('symbol')
      .order('sort_order')
    return data ?? []
  },
  ['buy_tranches'],
  { revalidate: 120, tags: ['buy_tranches'] }
)

export const getBuyTranches = cache(async (fyId: string): Promise<BuyTranche[]> => {
  const userId = await getUserId()
  if (!userId) return []
  return _fetchBuyTranches(userId, fyId)
})


export const getAIKeyStatus = cache(async (): Promise<{ hasKey: boolean }> => {
  const userId = await getUserId()
  if (!userId) return { hasKey: false }
  const { data } = await createSupabaseServiceClient()
    .from('user_settings')
    .select('gemini_api_key')
    .eq('user_id', userId)
    .maybeSingle()
  return { hasKey: !!data?.gemini_api_key }
})

export const getInvestability = cache(async (
  symbols: string[]
): Promise<Pick<Investability, 'symbol' | 'investable' | 'total_score'>[]> => {
  const userId = await getUserId()
  if (!userId || symbols.length === 0) return []
  const { data } = await createSupabaseServiceClient()
    .from('investability')
    .select('symbol, investable, total_score')
    .eq('user_id', userId)
    .in('symbol', symbols)
  return data ?? []
})

export const getInvestabilityForSymbol = cache(async (symbol: string): Promise<Investability | null> => {
  const userId = await getUserId()
  if (!userId) return null
  const { data } = await createSupabaseServiceClient()
    .from('investability')
    .select('id, symbol, assessed_at, g1_moat, g2_owner_earnings, g3_capital_efficiency, g4_innovation, g5_execution_track, g6_sector_winds, g7_governance, g8_supply_regulatory, g9_market_cap, g10_capital_discipline, total_score, investable, notes, rationale')
    .eq('user_id', userId)
    .eq('symbol', symbol)
    .maybeSingle()
  return data ?? null
})

const _fetchDividendsForSymbol = unstable_cache(
  async (userId: string, symbol: string): Promise<DividendTransaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('dividend_transactions')
      .select('id, symbol, exchange, ex_date, per_share, shares, amount, created_at')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('ex_date', { ascending: false })
    return data ?? []
  },
  ['dividend_transactions'],
  { revalidate: 300, tags: ['dividend_transactions'] }
)

export const getDividendsForSymbol = cache(async (symbol: string): Promise<DividendTransaction[]> => {
  const userId = await getUserId()
  if (!userId) return []
  return _fetchDividendsForSymbol(userId, symbol)
})

const _fetchAllDividends = unstable_cache(
  async (userId: string): Promise<DividendTransaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('dividend_transactions')
      .select('id, symbol, exchange, ex_date, per_share, shares, amount, created_at')
      .eq('user_id', userId)
      .order('ex_date', { ascending: false })
    return data ?? []
  },
  ['dividend_transactions_all'],
  { revalidate: 300, tags: ['dividend_transactions'] }
)

export const getAllDividends = cache(async (): Promise<DividendTransaction[]> => {
  const userId = await getUserId()
  if (!userId) return []
  return _fetchAllDividends(userId)
})


const _fetchLatestSnapshot = unstable_cache(
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
  },
  ['buy_band_snapshots'],
  { revalidate: 300, tags: ['buy_band_snapshots'] }
)

export const getLatestSnapshot = cache(async (symbol: string): Promise<BuyBandSnapshot | null> => {
  const userId = await getUserId()
  if (!userId) return null
  return _fetchLatestSnapshot(userId, symbol)
})

const _fetchLatestTwoSnapshots = unstable_cache(
  async (userId: string, symbol: string): Promise<BuyBandSnapshot[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('buy_band_snapshots')
      .select('id, symbol, pat_now, pat_3yr_ago, op_profit_cr, revenue_cr, g_computed, op_margin, label, snapshotted_at')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('snapshotted_at', { ascending: false })
      .limit(2)
    return data ?? []
  },
  ['buy_band_snapshots_two'],
  { revalidate: 300, tags: ['buy_band_snapshots'] }
)

export const getLatestSnapshots = cache(async (symbol: string): Promise<BuyBandSnapshot[]> => {
  const userId = await getUserId()
  if (!userId) return []
  return _fetchLatestTwoSnapshots(userId, symbol)
})
