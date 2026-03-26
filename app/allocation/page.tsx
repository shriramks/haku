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

  const fyIdx = fiscalYears.findIndex(f => f.id === currentFY?.id)
  const prevFY = fyIdx > 0 ? fiscalYears[fyIdx - 1] : null

  const [allocations, transactions, bands, prevAllocations, prevTransactions] = currentFY
    ? await Promise.all([
        getAllocations(currentFY.id),
        getTransactions(currentFY.id),
        getBuyBands(),
        prevFY ? getAllocations(prevFY.id) : Promise.resolve([]),
        prevFY ? getTransactions(prevFY.id) : Promise.resolve([]),
      ])
    : [[], [], [], [], []]

  return (
    <>
      <DashboardClient
        fiscalYears={fiscalYears}
        initialFY={currentFY ?? null}
        initialAllocations={allocations}
        initialTransactions={transactions}
        initialPrevFY={prevFY ?? null}
        initialPrevAllocations={prevAllocations}
        initialPrevTransactions={prevTransactions}
        bands={bands}
      />
      <BottomNav />
    </>
  )
}
