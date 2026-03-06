// Server-side data fetching helpers (used in Server Components only)
import { createSupabaseServerClient } from './supabase-server'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, Investability, BuyTranche, Playbook } from './types'

export async function getFiscalYears(): Promise<FiscalYear[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('fiscal_years')
    .select('*')
    .order('start_date', { ascending: true })
  return data ?? []
}

export async function getAllocations(fyId: string): Promise<StockAllocation[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('stock_allocations')
    .select('*')
    .eq('fy_id', fyId)
    .order('allocation_pct', { ascending: false })
  return data ?? []
}

export async function getTransactions(fyId?: string): Promise<Transaction[]> {
  const supabase = await createSupabaseServerClient()
  let q = supabase
    .from('transactions')
    .select('*')
    .order('trade_date', { ascending: false })
  if (fyId) q = q.eq('fy_id', fyId)
  const { data } = await q
  return data ?? []
}

/** Returns only the current (most-recent) band per symbol. */
export async function getBuyBands(): Promise<BuyBand[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('buy_bands')
    .select('*')
    .eq('is_current', true)
    .order('generated_at', { ascending: false })
  return data ?? []
}

export async function getInvestability(): Promise<Investability[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('investability').select('*')
  return data ?? []
}

export async function getBuyTranches(): Promise<BuyTranche[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('buy_tranches')
    .select('*')
    .order('symbol')
    .order('sort_order')
  return data ?? []
}

export async function getPlaybook(): Promise<Playbook | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('playbook')
    .select('*')
    .maybeSingle()
  return data ?? null
}
