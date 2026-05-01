'use server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { getUserId, getAllocations, getTransactions } from '@/lib/data'
import type { StockAllocation, Transaction } from '@/lib/types'

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

/** Computes undeployed amount from a previous FY's transactions vs budget */
export async function getPrevFYCarryover(prevFYId: string, prevFYBudget: number): Promise<number> {
  const userId = await getUserId()
  if (!userId) return 0
  const { data } = await createSupabaseServiceClient()
    .from('transactions')
    .select('trade_type, amount')
    .eq('user_id', userId)
    .eq('fy_id', prevFYId)
  const spent = (data ?? []).reduce(
    (s, t: { trade_type: string; amount: number }) =>
      s + (t.trade_type === 'buy' ? t.amount : -t.amount),
    0
  )
  return Math.max(0, prevFYBudget - spent)
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

/** Fetches allocations + transactions for a FY and its previous FY — used by DashboardClient switchFY */
export async function getFYData(fyId: string, prevFYId: string | null): Promise<{
  allocations: StockAllocation[]
  transactions: Transaction[]
  prevAllocations: StockAllocation[]
  prevTransactions: Transaction[]
}> {
  const [allocations, transactions, prevAllocations, prevTransactions] = await Promise.all([
    getAllocations(fyId),
    getTransactions(fyId),
    prevFYId ? getAllocations(prevFYId) : Promise.resolve([] as StockAllocation[]),
    prevFYId ? getTransactions(prevFYId) : Promise.resolve([] as Transaction[]),
  ])
  return { allocations, transactions, prevAllocations, prevTransactions }
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
