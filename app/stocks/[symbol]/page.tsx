import { getFiscalYears, getAllocations, getTransactions, getTransactionsBySymbol, getBuyBands, getBuyTranches, getAIKeyStatus, getCurrentFY } from '@/lib/data'
import { computeCarryover, computeStockRows, seqCost } from '@/lib/compute'
import type { BuyTranche } from '@/lib/types'
import BandDetailClient from '@/app/bands/[symbol]/BandDetailClient'
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

  const [allocations, transactions, allSymbolTxns, bands, prevAllocations, prevTransactions, tranches, aiKeyStatus] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
        getTransactionsBySymbol(symbol),
        getBuyBands(),
        prevFY ? getAllocations(prevFY.id) : Promise.resolve([]),
        prevFY ? getTransactions(prevFY.id) : Promise.resolve([]),
        getBuyTranches(fy.id),
        getAIKeyStatus(),
      ])
    : [[], [], [], [], [], [], [], { hasKey: false, provider: 'gemini' as const }]

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

  const allTimePosition = seqCost(allSymbolTxns)

  const allocation = allocations.find(a => a.symbol === symbol) ?? null
  const band       = bands.find(b => b.symbol === symbol) ?? null
  const { hasKey, provider: aiProvider } = aiKeyStatus as { hasKey: boolean; provider: 'gemini' | 'claude' }
  const backHref = fyParam ? `/allocation?fy=${encodeURIComponent(fyParam)}` : '/allocation'

  return (
    <>
      <BandDetailClient
        symbol={symbol}
        band={band}
        allocation={allocation}
        fyRow={fyRow}
        allTimeQty={allTimePosition.qty}
        allTimeCost={allTimePosition.cost}
        tranches={(tranches as BuyTranche[]).filter(t => t.symbol === symbol)}
        fyId={fy?.id ?? ''}
        fyLabel={fy?.label ?? ''}
        backHref={backHref}
        backLabel="Allocation"
        initialHasKey={hasKey}
        initialAiProvider={aiProvider}
      />
      <BottomNav />
    </>
  )
}
