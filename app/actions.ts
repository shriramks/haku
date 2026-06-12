'use server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { getUserId, getAllocations, getTransactions, getLatestSnapshot } from '@/lib/data'
import { fyIdForDate } from '@/lib/fy-utils'
import type { StockAllocation, Transaction, DividendTransaction, BuyBandSnapshot } from '@/lib/types'

export async function revalidateFiscalYears() {
  revalidateTag('fiscal_years', {})
}

export async function revalidateBuyBands() {
  revalidateTag('buy_bands', {})
}

export async function revalidateBuyTranches() {
  revalidateTag('buy_tranches', {})
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

// ── Stock transaction writes ──────────────────────────────────────────────────
// All writes to `transactions` go through these actions so the 'transactions'
// cache tag is invalidated — browser-side writes have no revalidation path.

export interface StockTxnInput {
  symbol: string
  exchange: string
  trade_date: string
  trade_type: 'buy' | 'sell'
  quantity: number
  price: number
}

/** Inserts a stock transaction; fy_id derived from trade_date. Returns the fy_id for follow-up actions (e.g. redeploy). */
export async function addStockTransaction(
  input: StockTxnInput
): Promise<{ fyId: string | null; error: string | null }> {
  const userId = await getUserId()
  if (!userId) return { fyId: null, error: 'Not signed in' }
  const svc = createSupabaseServiceClient()
  const fyId = await fyIdForDate(svc, input.trade_date, userId)
  const { error } = await svc.from('transactions').insert({
    ...input, user_id: userId, fy_id: fyId,
  })
  if (error) return { fyId, error: error.message }
  revalidateTag('transactions', {})
  return { fyId, error: null }
}

/** Updates qty/price/date of a stock transaction; fy_id re-derived from the new date. */
export async function updateStockTransaction(
  id: string,
  patch: { quantity: number; price: number; trade_date: string }
): Promise<{ fyId: string | null; error: string | null }> {
  const userId = await getUserId()
  if (!userId) return { fyId: null, error: 'Not signed in' }
  const svc = createSupabaseServiceClient()
  const fyId = await fyIdForDate(svc, patch.trade_date, userId)
  const { error } = await svc.from('transactions')
    .update({ ...patch, fy_id: fyId })
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

  const uniqueDates = [...new Set(rows.map(r => r.trade_date))]
  const fyByDate = new Map<string, string | null>()
  await Promise.all(uniqueDates.map(async d => {
    fyByDate.set(d, await fyIdForDate(svc, d, userId))
  }))

  const inserts = rows.map(r => ({
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
    for (const r of rows) {
      if (r.trade_type !== 'sell') continue
      const fyId = fyByDate.get(r.trade_date)
      if (!fyId) continue
      sellByFy.set(fyId, (sellByFy.get(fyId) ?? 0) + r.quantity * r.price)
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
  return inserted ?? []
}
