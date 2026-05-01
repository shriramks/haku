import {
  getFiscalYears, getAllocations, getTransactions, getBuyBands, getBuyTranches,
  getCurrentFY, getAIKeyStatus, getTransactionsBySymbol, getInvestabilityForSymbol,
} from './data'
import { computeCarryover, computeStockRows, seqCost } from './compute'
import type { FiscalYear, StockAllocation, BuyBand, BuyTranche, StockRow, Investability } from './types'

export interface StockDetailProps {
  fy: FiscalYear | null
  fyRow: StockRow | null
  band: BuyBand | null
  allocation: StockAllocation | null
  tranches: BuyTranche[]  // filtered to symbol, sorted price desc
  allTimeQty: number
  allTimeCost: number
  hasKey: boolean
  aiProvider: 'gemini' | 'claude'
  investability: Investability | null
}

/**
 * Shared data pipeline for the per-symbol detail pages (/bands/[symbol] and
 * /stocks/[symbol]). Both pages fetch the same FY data and compute the same
 * derived values; only backHref/backLabel differ and are set by each page.
 *
 * Pass fallbackToLast=true for the bands route, which should always show a
 * symbol even when no FY param is present (falls back to the last FY).
 */
export async function fetchStockDetailProps(
  symbol: string,
  fyParam: string | undefined,
  fallbackToLast = false,
): Promise<StockDetailProps> {
  const fiscalYears = await getFiscalYears()
  const fy = fallbackToLast
    ? (getCurrentFY(fiscalYears, fyParam) ?? fiscalYears[fiscalYears.length - 1])
    : getCurrentFY(fiscalYears, fyParam)

  const fyIdx = fiscalYears.findIndex(f => f.id === fy?.id)
  const prevFY = fyIdx > 0 ? fiscalYears[fyIdx - 1] : null

  const [
    allocations, transactions, bands, tranches,
    prevAllocations, prevTransactions,
    aiKeyStatus, symbolTxns, investability,
  ] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
        getBuyBands(),
        getBuyTranches(fy.id),
        prevFY ? getAllocations(prevFY.id) : Promise.resolve([]),
        prevFY ? getTransactions(prevFY.id) : Promise.resolve([]),
        getAIKeyStatus(),
        getTransactionsBySymbol(symbol),
        getInvestabilityForSymbol(symbol),
      ])
    : [[], [], [], [], [], [], { hasKey: false, provider: 'gemini' as const }, [], null]

  const carryoverMap = prevFY
    ? computeCarryover(
        prevAllocations, prevTransactions,
        prevFY.total_budget_inr + (prevFY.unallocated_carryover_inr ?? 0),
        prevFY.id, allocations,
      ).adjustments
    : undefined

  const totalBudget = (fy?.total_budget_inr ?? 0) + (fy?.unallocated_carryover_inr ?? 0)
  const rows = computeStockRows(allocations, transactions, bands, totalBudget, fy?.id, carryoverMap)
  const fyRow = rows.find(r => r.symbol === symbol) ?? null
  const allTimePosition = seqCost(symbolTxns as Parameters<typeof seqCost>[0])

  const band       = bands.find(b => b.symbol === symbol) ?? null
  const allocation = (allocations as StockAllocation[]).find(a => a.symbol === symbol) ?? null
  const stockTranches = (tranches as BuyTranche[])
    .filter(t => t.symbol === symbol)
    .sort((a, b) => b.price - a.price)
  const { hasKey, provider: aiProvider } =
    aiKeyStatus as { hasKey: boolean; provider: 'gemini' | 'claude' }

  return {
    fy,
    fyRow,
    band,
    allocation,
    tranches: stockTranches,
    allTimeQty: allTimePosition.qty,
    allTimeCost: allTimePosition.cost,
    hasKey,
    aiProvider,
    investability: (investability as Investability | null) ?? null,
  }
}
