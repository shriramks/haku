import {
  getFiscalYears, getAllocations, getTransactions, getBuyBands, getBuyTranches,
  getCurrentFY, getAIKeyStatus, getSymbolAllocations, getTransactionsBySymbol,
} from '@/lib/data'
import { computeStockRows, computeCarryover, seqCost } from '@/lib/compute'
import BandDetailClient from './BandDetailClient'
import BottomNav from '@/components/BottomNav'

export default async function BandDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>
  searchParams: Promise<{ fy?: string }>
}) {
  const { symbol } = await params
  const { fy: fyParam } = await searchParams

  const fiscalYears = await getFiscalYears()
  const fy = getCurrentFY(fiscalYears, fyParam) ?? fiscalYears[fiscalYears.length - 1]

  const fyIdx = fiscalYears.findIndex(f => f.id === fy?.id)
  const prevFY = fyIdx > 0 ? fiscalYears[fyIdx - 1] : null

  const [
    allocations, transactions, bands, tranches,
    prevAllocations, prevTransactions,
    aiKeyStatus, symbolAllocs, symbolTxns,
  ] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
        getBuyBands(),
        getBuyTranches(fy.id),
        prevFY ? getAllocations(prevFY.id) : Promise.resolve([]),
        prevFY ? getTransactions(prevFY.id) : Promise.resolve([]),
        getAIKeyStatus(),
        getSymbolAllocations(symbol),
        getTransactionsBySymbol(symbol),
      ])
    : [[], [], [], [], [], [], { hasKey: false, provider: 'gemini' as const }, [], []]

  const carryoverMap = prevFY
    ? computeCarryover(
        prevAllocations, prevTransactions,
        prevFY.total_budget_inr + (prevFY.unallocated_carryover_inr ?? 0),
        prevFY.id, allocations,
      ).adjustments
    : undefined

  const rows = computeStockRows(
    allocations, transactions, bands,
    (fy?.total_budget_inr ?? 0) + (fy?.unallocated_carryover_inr ?? 0),
    fy?.id, carryoverMap,
  )
  const fyRow = rows.find(r => r.symbol === symbol) ?? null

  // All-time budget = sum of each FY's budget for this stock
  const allTimeBudget = symbolAllocs.reduce((sum, alloc) => {
    const fyForAlloc = fiscalYears.find(f => f.id === alloc.fy_id)
    if (!fyForAlloc) return sum
    const fyBudget = fyForAlloc.total_budget_inr + (fyForAlloc.unallocated_carryover_inr ?? 0)
    return sum + (fyBudget * alloc.allocation_pct / 100)
  }, 0)

  // All-time spent = current holdings at cost (seqCost walks all transactions in order)
  const allTimePosition = seqCost(symbolTxns)
  const allTimeLeft = allTimeBudget - allTimePosition.cost

  const band = bands.find(b => b.symbol === symbol) ?? null
  const allocation = allocations.find(a => a.symbol === symbol) ?? null
  const stockTranches = tranches.filter(t => t.symbol === symbol).sort((a, b) => b.price - a.price)
  const { hasKey, provider } = aiKeyStatus as { hasKey: boolean; provider: 'gemini' | 'claude' }

  return (
    <>
      <BandDetailClient
        symbol={symbol}
        band={band}
        allocation={allocation}
        fyRow={fyRow}
        allTimeLeft={allTimeLeft}
        tranches={stockTranches}
        fyId={fy?.id ?? ''}
        fiscalYears={fiscalYears}
        selectedFY={fy ?? null}
        initialHasKey={hasKey}
        initialAiProvider={provider}
      />
      <BottomNav />
    </>
  )
}
