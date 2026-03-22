// Server-side data fetching helpers (used in Server Components only)
import { cache } from 'react'
import { createSupabaseServerClient } from './supabase-server'
import { createSupabaseServiceClient } from './supabase-service'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, Investability, BuyTranche, Playbook } from './types'

// cache() deduplicates calls with identical arguments within a single request.
// No cross-request caching = always fresh data, no staleness bugs.

export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServerClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user.id ?? null
})

export const getFiscalYears = cache(async (): Promise<FiscalYear[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const { data } = await createSupabaseServiceClient()
    .from('fiscal_years')
    .select('id, label, start_date, end_date, total_budget_inr, unallocated_carryover_inr')
    .eq('user_id', userId)
    .order('start_date', { ascending: true })
  return data ?? []
})

export const getAllocations = cache(async (fyId: string): Promise<StockAllocation[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const { data } = await createSupabaseServiceClient()
    .from('stock_allocations')
    .select('id, fy_id, symbol, exchange, allocation_pct, category, two_weak_quarters, two_strong_quarters, is_hospital_ramp_phase')
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
    .select('id, symbol, exchange, trade_date, trade_type, quantity, price, amount, fy_id, advance_fy_id, notes')
    .eq('user_id', userId)
    .order('trade_date', { ascending: false })
  const { data } = fyId
    ? await q.or(`fy_id.eq.${fyId},advance_fy_id.eq.${fyId}`)
    : await q
  return data ?? []
})

export const getSymbolAllocations = cache(async (symbol: string): Promise<StockAllocation[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const { data } = await createSupabaseServiceClient()
    .from('stock_allocations')
    .select('id, fy_id, symbol, exchange, allocation_pct, category, two_weak_quarters, two_strong_quarters, is_hospital_ramp_phase')
    .eq('user_id', userId)
    .eq('symbol', symbol)
    .order('fy_id', { ascending: true })
  return data ?? []
})

export const getBuyBands = cache(async (): Promise<BuyBand[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const { data } = await createSupabaseServiceClient()
    .from('buy_bands')
    .select('id, symbol, anchor_type, eps, bvps, ebitda, net_debt, shares, embedded_value, buy_low, buy_high, mid_low, mid_high, trim_price, manual_cmp, last_updated_at, generated_at, is_current, notes')
    .eq('user_id', userId)
    .eq('is_current', true)
    .order('generated_at', { ascending: false })
  return data ?? []
})

export const getInvestability = cache(async (): Promise<Investability[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const { data } = await createSupabaseServiceClient()
    .from('investability')
    .select('id, symbol, assessed_at, sector_winds, sector_winds_note, circle_of_competence, circle_note, moat, moat_note, owner_earnings, owner_earnings_note, capital_efficiency, capital_efficiency_note, innovation_velocity, innovation_note, governance, governance_note, execution_track, execution_note, supply_chain_risk, supply_chain_note, regulatory_signal, regulatory_note, thesis_breaker, thesis_breaker_note, capital_discipline, capital_discipline_note, investable, notes')
    .eq('user_id', userId)
  return data ?? []
})

export const getBuyTranches = cache(async (fyId: string): Promise<BuyTranche[]> => {
  const userId = await getUserId()
  if (!userId) return []
  const { data } = await createSupabaseServiceClient()
    .from('buy_tranches')
    .select('id, symbol, qty, price, allocated, sort_order, fy_id, created_at')
    .eq('user_id', userId)
    .eq('fy_id', fyId)
    .order('symbol')
    .order('sort_order')
  return data ?? []
})

export const getPlaybook = cache(async (): Promise<Playbook | null> => {
  const userId = await getUserId()
  if (!userId) return null
  const { data } = await createSupabaseServiceClient()
    .from('playbook')
    .select('id, content, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  return data ?? null
})
