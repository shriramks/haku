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

  const allTimePosition = seqCost(symbolTxns)

  const band = bands.find(b => b.symbol === symbol) ?? null
  const allocation = allocations.find(a => a.symbol === symbol) ?? null
  const stockTranches = tranches.filter(t => t.symbol === symbol).sort((a, b) => b.price - a.price)
  const { hasKey, provider } = aiKeyStatus as { hasKey: boolean; provider: 'gemini' | 'claude' }
  const fyLabel = fy?.label
  const backHref = fyLabel ? `/bands?fy=${encodeURIComponent(fyLabel)}` : '/bands'

  return (
    <>
      <BandDetailClient
        symbol={symbol}
        band={band}
        allocation={allocation}
        fyRow={fyRow}
        allTimeQty={allTimePosition.qty}
        allTimeCost={allTimePosition.cost}
        allTimeAvgCost={allTimePosition.buyAvgCost}
        tranches={stockTranches}
        fyId={fy?.id ?? ''}
        backHref={backHref}
        backLabel="Bands"
        initialHasKey={hasKey}
        initialAiProvider={provider}
      />
      <BottomNav />
    </>
  )
}
