import { getFiscalYears, getAllocations, getTransactions, getBuyBands } from '@/lib/data'
import DashboardClient from './DashboardClient'
import BottomNav from '@/components/BottomNav'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  const fiscalYears = await getFiscalYears()
  const { fy: fyParam } = await searchParams

  // Default to current FY (Apr–Mar), fallback to most recent
  const today = new Date()
  const currentFY = fyParam
    ? (fiscalYears.find(f => f.label === fyParam) ?? fiscalYears[0])
    : (fiscalYears.find(fy =>
        new Date(fy.start_date) <= today && today <= new Date(fy.end_date)
      ) ?? fiscalYears[0])

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
