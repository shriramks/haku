'use server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { getUserId, getAllocations, getTransactions, getLatestSnapshot } from '@/lib/data'
import type { StockAllocation, Transaction, DividendTransaction, BuyBandSnapshot } from '@/lib/types'

export async function revalidateFiscalYears() {
  revalidateTag('fiscal_years', {})
}

export async function revalidateBuyBands() {
  revalidateTag('buy_bands', {})
}

/** Fetch allocations for a FY — used by PlanClient on FY switch */
export async function getAllocationsForFY(fyId: string): Promise<StockAllocation[]> {
  return getAllocations(fyId)
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
 * net deployed (all buys minus all sell proceeds). Can be negative if over-invested.
 */
export async function getPrevFYCarryover(prevFYId: string, prevFYPool: number): Promise<number> {
  const userId = await getUserId()
  if (!userId) return 0
  const { data } = await createSupabaseServiceClient()
    .from('transactions')
    .select('trade_type, amount')
    .eq('user_id', userId)
    .eq('fy_id', prevFYId)
  const netDeployed = (data ?? []).reduce(
    (s, t: { trade_type: string; amount: number }) =>
      s + (t.trade_type === 'buy' ? t.amount : -t.amount),
    0
  )
  return prevFYPool - netDeployed
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

/** Fetches allocations + transactions for a FY — used by DashboardClient switchFY */
export async function getFYData(fyId: string): Promise<{
  allocations: StockAllocation[]
  transactions: Transaction[]
}> {
  const [allocations, transactions] = await Promise.all([
    getAllocations(fyId),
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
  return inserted ?? []
}
