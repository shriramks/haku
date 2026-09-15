import { getFiscalYears, getAllocations, getTransactions, getBuyBands, getCurrentFY } from '@/lib/data'
import { computeAllTimeHoldings } from '@/lib/compute'
import DashboardClient from './DashboardClient'
import BottomNav from '@/components/BottomNav'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  // getTransactions()/getBuyBands() don't depend on the current FY — fire them
  // alongside getFiscalYears() instead of behind it, so a cold fiscal_years cache
  // doesn't serialize in front of two otherwise-independent queries.
  const [fiscalYears, { fy: fyParam }, allTransactions, bands] = await Promise.all([
    getFiscalYears(),
    searchParams,
    getTransactions(),
    getBuyBands(),
  ])

  const currentFY = getCurrentFY(fiscalYears, fyParam)

  const [allocations, transactions] = currentFY
    ? await Promise.all([
        getAllocations(currentFY.id),
        getTransactions(currentFY.id),
      ])
    : [[], []]

  // Per-symbol all-time aggregates only — the full history stays server-side
  const allTimeHoldings = computeAllTimeHoldings(allTransactions)

  return (
    <>
      <DashboardClient
        fiscalYears={fiscalYears}
        initialFY={currentFY ?? null}
        initialAllocations={allocations}
        initialTransactions={transactions}
        allTimeHoldings={allTimeHoldings}
        bands={bands}
      />
      <BottomNav />
    </>
  )
}
