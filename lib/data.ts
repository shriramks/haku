// Server-side data fetching helpers (used in Server Components only)
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createSupabaseServerClient } from './supabase-server'
import { createSupabaseServiceClient } from './supabase-service'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, Investability, BuyTranche, Playbook } from './types'

// ── Auth helper ───────────────────────────────────────────────────────────────
// cache() deduplicates across all calls within a single request render

export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
})

// ── Cached fetchers (service role — no cookies needed) ────────────────────────

const _getFiscalYears = unstable_cache(
  async (userId: string): Promise<FiscalYear[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('fiscal_years')
      .select('id, label, start_date, end_date, total_budget_inr, unallocated_carryover_inr')
      .eq('user_id', userId)
      .order('start_date', { ascending: true })
    return data ?? []
  },
  ['fiscal_years'],
  { revalidate: 300 }, // 5 min — fiscal years change rarely
)

const _getAllocations = unstable_cache(
  async (userId: string, fyId: string): Promise<StockAllocation[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('stock_allocations')
      .select('id, fy_id, symbol, exchange, allocation_pct, category, two_weak_quarters, two_strong_quarters, is_hospital_ramp_phase, carryover_inr')
      .eq('user_id', userId)
      .eq('fy_id', fyId)
      .order('allocation_pct', { ascending: false })
    return data ?? []
  },
  ['allocations'],
  { revalidate: 60 },
)

const _getTransactions = unstable_cache(
  async (userId: string, fyId: string): Promise<Transaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('transactions')
      .select('id, symbol, exchange, trade_date, trade_type, quantity, price, amount, fy_id, advance_fy_id, notes')
      .eq('user_id', userId)
      .or(`and(fy_id.eq.${fyId},advance_fy_id.is.null),advance_fy_id.eq.${fyId}`)
      .order('trade_date', { ascending: false })
    return data ?? []
  },
  ['transactions'],
  { revalidate: 30 },
)

const _getTransactionsAll = unstable_cache(
  async (userId: string): Promise<Transaction[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('transactions')
      .select('id, symbol, exchange, trade_date, trade_type, quantity, price, amount, fy_id, advance_fy_id, notes')
      .eq('user_id', userId)
      .order('trade_date', { ascending: false })
    return data ?? []
  },
  ['transactions_all'],
  { revalidate: 30 },
)

const _getBuyBands = unstable_cache(
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
  { revalidate: 60 },
)

const _getInvestability = unstable_cache(
  async (userId: string): Promise<Investability[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('investability')
      .select('id, symbol, assessed_at, sector_winds, sector_winds_note, circle_of_competence, circle_note, moat, moat_note, owner_earnings, owner_earnings_note, capital_efficiency, capital_efficiency_note, innovation_velocity, innovation_note, governance, governance_note, execution_track, execution_note, supply_chain_risk, supply_chain_note, regulatory_signal, regulatory_note, thesis_breaker, thesis_breaker_note, capital_discipline, capital_discipline_note, investable, notes')
      .eq('user_id', userId)
    return data ?? []
  },
  ['investability'],
  { revalidate: 300 },
)

const _getBuyTranches = unstable_cache(
  async (userId: string, fyId: string): Promise<BuyTranche[]> => {
    const { data } = await createSupabaseServiceClient()
      .from('buy_tranches')
      .select('id, symbol, qty, price, allocated, sort_order, fy_id, created_at')
      .eq('user_id', userId)
      .eq('fy_id', fyId)
      .order('symbol')
      .order('sort_order')
    return data ?? []
  },
  ['buy_tranches'],
  { revalidate: 30 },
)

const _getPlaybook = unstable_cache(
  async (userId: string): Promise<Playbook | null> => {
    const { data } = await createSupabaseServiceClient()
      .from('playbook')
      .select('id, content, updated_at')
      .eq('user_id', userId)
      .maybeSingle()
    return data ?? null
  },
  ['playbook'],
  { revalidate: 300 },
)

// ── Public API ────────────────────────────────────────────────────────────────

export async function getFiscalYears(): Promise<FiscalYear[]> {
  const userId = await getUserId()
  if (!userId) return []
  return _getFiscalYears(userId)
}

export async function getAllocations(fyId: string): Promise<StockAllocation[]> {
  const userId = await getUserId()
  if (!userId) return []
  return _getAllocations(userId, fyId)
}

export async function getTransactions(fyId?: string): Promise<Transaction[]> {
  const userId = await getUserId()
  if (!userId) return []
  if (!fyId) return _getTransactionsAll(userId)
  return _getTransactions(userId, fyId)
}

export async function getBuyBands(): Promise<BuyBand[]> {
  const userId = await getUserId()
  if (!userId) return []
  return _getBuyBands(userId)
}

export async function getInvestability(): Promise<Investability[]> {
  const userId = await getUserId()
  if (!userId) return []
  return _getInvestability(userId)
}

export async function getBuyTranches(fyId: string): Promise<BuyTranche[]> {
  const userId = await getUserId()
  if (!userId) return []
  return _getBuyTranches(userId, fyId)
}

export async function getPlaybook(): Promise<Playbook | null> {
  const userId = await getUserId()
  if (!userId) return null
  return _getPlaybook(userId)
}
