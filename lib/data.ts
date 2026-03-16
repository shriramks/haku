// Server-side data fetching helpers (used in Server Components only)
import { createSupabaseServerClient } from './supabase-server'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, Investability, BuyTranche, Playbook } from './types'

export async function getFiscalYears(): Promise<FiscalYear[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('fiscal_years')
    .select('id, label, start_date, end_date, total_budget_inr, unallocated_carryover_inr')
    .order('start_date', { ascending: true })
  return data ?? []
}

export async function getAllocations(fyId: string): Promise<StockAllocation[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('stock_allocations')
    .select('id, fy_id, symbol, exchange, allocation_pct, category, two_weak_quarters, two_strong_quarters, is_hospital_ramp_phase, carryover_inr')
    .eq('fy_id', fyId)
    .order('allocation_pct', { ascending: false })
  return data ?? []
}

export async function getTransactions(fyId?: string): Promise<Transaction[]> {
  const supabase = await createSupabaseServerClient()
  let q = supabase
    .from('transactions')
    .select('id, symbol, exchange, trade_date, trade_type, quantity, price, amount, fy_id, advance_fy_id, notes')
    .order('trade_date', { ascending: false })
  if (fyId) {
    // Include transactions belonging to this FY (and not re-attributed elsewhere),
    // plus any transactions from other FYs that have been advance-tagged to this FY.
    q = q.or(`and(fy_id.eq.${fyId},advance_fy_id.is.null),advance_fy_id.eq.${fyId}`)
  }
  const { data } = await q
  return data ?? []
}

/** Returns only the current (most-recent) band per symbol. */
export async function getBuyBands(): Promise<BuyBand[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('buy_bands')
    .select('id, symbol, anchor_type, eps, bvps, ebitda, net_debt, shares, embedded_value, buy_low, buy_high, mid_low, mid_high, trim_price, manual_cmp, last_updated_at, generated_at, is_current, notes')
    .eq('is_current', true)
    .order('generated_at', { ascending: false })
  return data ?? []
}

export async function getInvestability(): Promise<Investability[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('investability')
    .select('id, symbol, assessed_at, sector_winds, sector_winds_note, circle_of_competence, circle_note, moat, moat_note, owner_earnings, owner_earnings_note, capital_efficiency, capital_efficiency_note, innovation_velocity, innovation_note, governance, governance_note, execution_track, execution_note, supply_chain_risk, supply_chain_note, regulatory_signal, regulatory_note, thesis_breaker, thesis_breaker_note, capital_discipline, capital_discipline_note, investable, notes')
  return data ?? []
}

export async function getBuyTranches(fyId: string): Promise<BuyTranche[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('buy_tranches')
    .select('id, symbol, qty, price, allocated, sort_order, fy_id, created_at')
    .eq('fy_id', fyId)
    .order('symbol')
    .order('sort_order')
  return data ?? []
}

export async function getPlaybook(): Promise<Playbook | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('playbook')
    .select('id, content, updated_at')
    .maybeSingle()
  return data ?? null
}
