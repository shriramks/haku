// Server-side data fetching helpers (used in Server Components)
import { createSupabaseServerClient } from './supabase-server'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, Investability } from './types'
import { getBandSignal } from './band-calculator'
import type { StockRow } from './types'

export async function getFiscalYears(): Promise<FiscalYear[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('fiscal_years')
    .select('*')
    .order('start_date', { ascending: false })
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

export async function getBuyBands(): Promise<BuyBand[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('buy_bands').select('*')
  return data ?? []
}

export async function getInvestability(): Promise<Investability[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('investability').select('*')
  return data ?? []
}

// ── Computed helpers ─────────────────────────────────────────────────────────

export function computeStockRows(
  allocations: StockAllocation[],
  transactions: Transaction[],
  bands: BuyBand[],
  totalBudget: number
): StockRow[] {
  return allocations.map(alloc => {
    const txns  = transactions.filter(t => t.symbol === alloc.symbol)
    const buys  = txns.filter(t => t.trade_type === 'buy')
    const sells = txns.filter(t => t.trade_type === 'sell')

    const totalBought   = buys.reduce((s, t)  => s + t.quantity, 0)
    const totalBuyValue = buys.reduce((s, t)  => s + t.amount,   0)
    const totalSold     = sells.reduce((s, t) => s + t.quantity,  0)

    const qty     = Math.max(0, totalBought - totalSold)
    const avgCost = totalBought > 0 ? totalBuyValue / totalBought : 0
    const spent   = buys.reduce((s, t) => s + t.amount, 0)
                  - sells.reduce((s, t) => s + t.amount, 0)

    const budget    = (alloc.allocation_pct / 100) * totalBudget
    const remaining = budget - spent

    const band   = bands.find(b => b.symbol === alloc.symbol) ?? null
    const cmp    = band?.manual_cmp ?? null
    const signal = band ? getBandSignal(band) : 'unknown'

    const unrealisedPnL    = cmp !== null ? (cmp - avgCost) * qty : null
    const unrealisedPnLPct = (cmp !== null && avgCost > 0)
      ? (cmp - avgCost) / avgCost * 100 : null

    return {
      symbol:          alloc.symbol,
      allocationPct:   alloc.allocation_pct,
      budget,
      spent,
      remaining,
      pctRemaining:    budget > 0 ? (remaining / budget) * 100 : 100,
      qty,
      avgCost,
      cmp,
      unrealisedPnL,
      unrealisedPnLPct,
      bandSignal:      signal,
    }
  })
}
