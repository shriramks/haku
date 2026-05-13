import { getFiscalYears, getAllocations, getTransactions, getBuyBands, getCurrentFY, getInvestability } from '@/lib/data'
import { computeStockRows } from '@/lib/compute'
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

  const [allocations, transactions, bands] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
        getBuyBands(),
      ])
    : [[], [], []]

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
