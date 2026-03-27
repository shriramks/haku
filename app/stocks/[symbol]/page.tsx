import { getFiscalYears, getAllocations, getTransactions, getTransactionsBySymbol, getSymbolAllocations, getBuyBands, getBuyTranches, getAIKeyStatus, getCurrentFY, getUserId } from '@/lib/data'
import { computeCarryover } from '@/lib/compute'
import type { BuyTranche } from '@/lib/types'
import StockDetailClient from './StockDetailClient'
import BottomNav from '@/components/BottomNav'

export default async function StockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>
  searchParams: Promise<{ fy?: string }>
}) {
  const { symbol } = await params
  const { fy: fyParam } = await searchParams

  const fiscalYears = await getFiscalYears()
  const fy = getCurrentFY(fiscalYears, fyParam)

  const fyIdx = fiscalYears.findIndex(f => f.id === fy?.id)
  const prevFY = fyIdx > 0 ? fiscalYears[fyIdx - 1] : null

  const [allocations, transactions, allSymbolTxns, bands, symbolAllocations, prevAllocations, prevTransactions, tranches, aiKeyStatus] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
        getTransactionsBySymbol(symbol),
        getBuyBands(),
        getSymbolAllocations(symbol),
        prevFY ? getAllocations(prevFY.id) : Promise.resolve([]),
        prevFY ? getTransactions(prevFY.id) : Promise.resolve([]),
        getBuyTranches(fy.id),
        getAIKeyStatus(),
      ])
    : [[], [], [], [], [], [], [], [], { hasKey: false, provider: 'gemini' as const }]

  // Compute carryover for this stock in the current FY
  const carryoverInr = (() => {
    if (!prevFY || !fy) return 0
    const prevBudget = prevFY.total_budget_inr + (prevFY.unallocated_carryover_inr ?? 0)
    const result = computeCarryover(prevAllocations, prevTransactions, prevBudget, prevFY.id, allocations)
    return result.adjustments.get(symbol) ?? 0
  })()

  const allocation = allocations.find(a => a.symbol === symbol) ?? null
  const band       = bands.find(b => b.symbol === symbol) ?? null
  const stockTxns  = transactions.filter(t => t.symbol === symbol)
  const { hasKey, provider: aiProvider } = aiKeyStatus as { hasKey: boolean; provider: 'gemini' | 'claude' }

  // All-FY budget: sum of base allocations only (carryover excluded to avoid double-counting)
  const allFYBudget = symbolAllocations.reduce((sum, alloc) => {
    const fyRow = fiscalYears.find(f => f.id === alloc.fy_id)
    if (!fyRow) return sum
    return sum + (alloc.allocation_pct / 100) * (fyRow.total_budget_inr + (fyRow.unallocated_carryover_inr ?? 0))
  }, 0)

  return (
    <>
      <StockDetailClient
        symbol={symbol}
        fiscalYear={fy ?? null}
        allocation={allocation}
        transactions={stockTxns}
        allTransactions={allSymbolTxns as typeof stockTxns}
        allFYBudget={allFYBudget}
        carryoverInr={carryoverInr}
        band={band}
        initialTranches={(tranches as BuyTranche[]).filter(t => t.symbol === symbol)}
        hasKey={hasKey}
        aiProvider={aiProvider}
        userId={await getUserId() ?? ''}
      />
      <BottomNav />
    </>
  )
}
