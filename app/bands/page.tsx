import { getFiscalYears, getAllocations, getTransactions, getBuyBands, getCurrentFY } from '@/lib/data'
import { computeStockRows, computeCarryover } from '@/lib/compute'
import BandsClient from './BandsClient'
import BottomNav from '@/components/BottomNav'

export default async function BandsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  const fiscalYears = await getFiscalYears()
  const { fy: fyParam } = await searchParams
  const fy = getCurrentFY(fiscalYears, fyParam) ?? fiscalYears[fiscalYears.length - 1]

  const fyIdx = fiscalYears.findIndex(f => f.id === fy?.id)
  const prevFY = fyIdx > 0 ? fiscalYears[fyIdx - 1] : null

  const [allocations, transactions, bands, prevAllocations, prevTransactions] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
        getBuyBands(),
        prevFY ? getAllocations(prevFY.id) : Promise.resolve([]),
        prevFY ? getTransactions(prevFY.id) : Promise.resolve([]),
      ])
    : [[], [], [], [], []]

  const carryoverMap = prevFY
    ? computeCarryover(prevAllocations, prevTransactions, prevFY.total_budget_inr + (prevFY.unallocated_carryover_inr ?? 0), prevFY.id, allocations).adjustments
    : undefined

  const rows = computeStockRows(allocations, transactions, bands, (fy?.total_budget_inr ?? 0) + (fy?.unallocated_carryover_inr ?? 0), fy?.id, carryoverMap)
  const sorted = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol))

  return (
    <>
      <BandsClient
        rows={sorted}
        bands={bands}
        allocations={allocations}
        fyId={fy?.id ?? ''}
        fiscalYears={fiscalYears}
        selectedFY={fy ?? null}
      />
      <BottomNav />
    </>
  )
}
