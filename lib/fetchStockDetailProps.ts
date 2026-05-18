import {
  getFiscalYears, getAllocations, getTransactions, getBuyBands, getBuyTranches,
  getCurrentFY, getAIKeyStatus, getTransactionsBySymbol, getInvestabilityForSymbol,
  getLatestSnapshots,
} from './data'
import { computeStockRows, seqCost } from './compute'
import type { FiscalYear, StockAllocation, BuyBand, BuyTranche, StockRow, Investability, Transaction, BuyBandSnapshot } from './types'

export interface StockDetailProps {
  fy: FiscalYear | null
  fyRow: StockRow | null
  band: BuyBand | null
  allocation: StockAllocation | null
  tranches: BuyTranche[]  // filtered to symbol, sorted price desc
  allTimeQty: number
  allTimeCost: number
  hasKey: boolean
  investability: Investability | null
  symbolTxns: Transaction[]
  initialSnapshot: BuyBandSnapshot | null
  initialPriorSnapshot: BuyBandSnapshot | null
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

  const [
    allocations, transactions, bands, tranches,
    aiKeyStatus, symbolTxns, investability, snapshots,
  ] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
        getBuyBands(),
        getBuyTranches(fy.id),
        getAIKeyStatus(),
        getTransactionsBySymbol(symbol),
        getInvestabilityForSymbol(symbol),
        getLatestSnapshots(symbol),
      ])
    : await Promise.all([
        Promise.resolve([]),
        Promise.resolve([]),
        getBuyBands(),
        Promise.resolve([]),
        getAIKeyStatus(),
        getTransactionsBySymbol(symbol),
        getInvestabilityForSymbol(symbol),
        getLatestSnapshots(symbol),
      ])

  const totalBudget = (fy?.total_budget_inr ?? 0) + (fy?.unallocated_carryover_inr ?? 0)
  const rows = computeStockRows(allocations, transactions, bands, totalBudget)
  const fyRow = rows.find(r => r.symbol === symbol) ?? null
  const allTimePosition = seqCost(symbolTxns as Parameters<typeof seqCost>[0])

  const band       = bands.find(b => b.symbol === symbol) ?? null
  const allocation = (allocations as StockAllocation[]).find(a => a.symbol === symbol) ?? null
  const stockTranches = (tranches as BuyTranche[])
    .filter(t => t.symbol === symbol)
    .sort((a, b) => b.price - a.price)
  const { hasKey } = aiKeyStatus as { hasKey: boolean }

  const snapshotArr = snapshots as BuyBandSnapshot[]
  return {
    fy,
    fyRow,
    band,
    allocation,
    tranches: stockTranches,
    allTimeQty: allTimePosition.qty,
    allTimeCost: allTimePosition.cost,
    hasKey,
    investability: (investability as Investability | null) ?? null,
    symbolTxns: (symbolTxns as Transaction[]),
    initialSnapshot: snapshotArr[0] ?? null,
    initialPriorSnapshot: snapshotArr[1] ?? null,
  }
}
