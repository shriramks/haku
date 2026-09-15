import { getFiscalYears, getAllocations, getTransactions, getBuyBands, getCurrentFY, getInvestability } from '@/lib/data'
import { computeStockRows } from '@/lib/compute'
import BandsClient from './BandsClient'
import BottomNav from '@/components/BottomNav'

export default async function BandsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  // getBuyBands() doesn't depend on the current FY — fire it alongside
  // getFiscalYears() instead of behind it, mirroring the allocation page fix.
  const [fiscalYears, { fy: fyParam }, bands] = await Promise.all([
    getFiscalYears(),
    searchParams,
    getBuyBands(),
  ])
  const fy = getCurrentFY(fiscalYears, fyParam) ?? fiscalYears[fiscalYears.length - 1]

  const [allocations, transactions] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
      ])
    : [[], []]

  const symbols = allocations.map((a: { symbol: string }) => a.symbol)
  const investabilities = await getInvestability(symbols)

  const rows = computeStockRows(allocations, transactions, bands, (fy?.total_budget_inr ?? 0) + (fy?.unallocated_carryover_inr ?? 0))
  const sorted = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol))

  return (
    <>
      <BandsClient
        rows={sorted}
        bands={bands}
        fyId={fy?.id ?? ''}
        fiscalYears={fiscalYears}
        selectedFY={fy ?? null}
        investabilities={investabilities}
      />
      <BottomNav />
    </>
  )
}
