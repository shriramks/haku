// Server-side data fetching helpers (used in Server Components only)
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createSupabaseServerClient } from './supabase-server'
import { createSupabaseServiceClient } from './supabase-service'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, Investability, BuyTranche } from './types'

// cache()         — deduplicates within a single request (per-render)
// unstable_cache  — persists across requests in the Next.js Data Cache
//
// Caching policy:
//   getFiscalYears : 1 hour   — changes only when user creates/edits a plan
//   getBuyBands    : 5 min    — on-demand revalidated via revalidateTag('buy_bands') on generate
//   getBuyTranches : 2 min    — on-demand revalidated via revalidateTag('buy_tranches') on generate
//   everything else: no cross-request cache — mutated client-side without server invalidation paths

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
    .select('id, fy_id, symbol, exchange, allocation_pct, category, two_weak_quarters, two_strong_quarters')
    .eq('user_id', userId)
    .eq('fy_id', fyId)
    .order('allocation_pct', { ascending: false })
  return data ?? []
})

export const getTransactions = cache(async (fyId?: string): Promise<Transaction[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const q = createSupabaseServiceClient()
    .from('transactions')
    .select('id, symbol, exchange, trade_date, trade_type, quantity, price, amount, fy_id, advance_fy_id, notes, created_at')
    .eq('user_id', userId)
    .order('trade_date', { ascending: false })
    .order('created_at', { ascending: false })
  const { data } = fyId
    ? await q.or(`fy_id.eq.${fyId},advance_fy_id.eq.${fyId}`)
    : await q
  return data ?? []
})

export const getTransactionsBySymbol = cache(async (symbol: string): Promise<Transaction[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const { data } = await createSupabaseServiceClient()
    .from('transactions')
    .select('id, symbol, exchange, trade_date, trade_type, quantity, price, amount, fy_id, advance_fy_id, notes')
    .eq('user_id', userId)
    .eq('symbol', symbol)
    .order('trade_date', { ascending: false })
  return data ?? []
})

export const getSymbolAllocations = cache(async (symbol: string): Promise<StockAllocation[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const { data } = await createSupabaseServiceClient()
    .from('stock_allocations')
    .select('id, fy_id, symbol, exchange, allocation_pct, category, two_weak_quarters, two_strong_quarters')
    .eq('user_id', userId)
    .eq('symbol', symbol)
    .order('fy_id', { ascending: true })
  return data ?? []
})

const _fetchBuyBands = unstable_cache(
  async (userId: string): Promise<BuyBand[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('buy_bands')
      .select('id, symbol, anchor_type, eps, bvps, ebitda, net_debt, shares, embedded_value, buy_low, buy_high, mid_low, mid_high, trim_price, manual_cmp, last_updated_at, generated_at, is_current, notes')
      .eq('user_id', userId)
      .eq('is_current', true)
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

export const getInvestability = cache(async (symbol?: string): Promise<Investability[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const q = createSupabaseServiceClient()
    .from('investability')
    .select('id, symbol, assessed_at, sector_winds, sector_winds_note, circle_of_competence, circle_note, moat, moat_note, owner_earnings, owner_earnings_note, capital_efficiency, capital_efficiency_note, innovation_velocity, innovation_note, governance, governance_note, execution_track, execution_note, supply_chain_risk, supply_chain_note, regulatory_signal, regulatory_note, thesis_breaker, thesis_breaker_note, capital_discipline, capital_discipline_note, investable, notes')
    .eq('user_id', userId)
  const { data } = symbol ? await q.eq('symbol', symbol) : await q
  return data ?? []
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

/** Selects the active FY from a list. If fyParam is given, finds by label; otherwise picks the FY whose date range contains today, falling back to the most recent. */
export function getCurrentFY(fiscalYears: FiscalYear[], fyParam?: string): FiscalYear | null {
  if (!fiscalYears.length) return null
  if (fyParam) return fiscalYears.find(f => f.label === fyParam) ?? fiscalYears[0]
  const today = new Date()
  return fiscalYears.find(fy =>
    new Date(fy.start_date) <= today && today <= new Date(fy.end_date)
  ) ?? fiscalYears[0]
}

export const getAIKeyStatus = cache(async (): Promise<{ hasKey: boolean; provider: 'gemini' | 'claude' }> => {
  const userId = await getUserId()
  if (!userId) return { hasKey: false, provider: 'gemini' }
  const { data } = await createSupabaseServiceClient()
    .from('user_settings')
    .select('gemini_api_key, claude_api_key, ai_provider')
    .eq('user_id', userId)
    .maybeSingle()
  const provider = (data?.ai_provider ?? 'gemini') as 'gemini' | 'claude'
  const hasKey = provider === 'claude' ? !!(data?.claude_api_key) : !!(data?.gemini_api_key)
  return { hasKey, provider }
})
