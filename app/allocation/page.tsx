import { getFiscalYears, getAllocations, getTransactions, getBuyBands, getCurrentFY } from '@/lib/data'
import DashboardClient from './DashboardClient'
import BottomNav from '@/components/BottomNav'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  const fiscalYears = await getFiscalYears()
  const { fy: fyParam } = await searchParams

  const currentFY = getCurrentFY(fiscalYears, fyParam)

  const [allocations, transactions, allTransactions, bands] = currentFY
    ? await Promise.all([
        getAllocations(currentFY.id),
        getTransactions(currentFY.id),
        getTransactions(),
        getBuyBands(),
      ])
    : [[], [], [], []]

  return (
    <>
      <DashboardClient
        fiscalYears={fiscalYears}
        initialFY={currentFY ?? null}
        initialAllocations={allocations}
        initialTransactions={transactions}
        initialAllTransactions={allTransactions}
        bands={bands}
      />
      <BottomNav />
    </>
  )
}
