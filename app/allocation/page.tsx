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

  const [allocations, transactions, bands] = currentFY
    ? await Promise.all([
        getAllocations(currentFY.id),
        getTransactions(currentFY.id),
        getBuyBands(),
      ])
    : [[], [], []]

  return (
    <>
      <DashboardClient
        fiscalYears={fiscalYears}
        initialFY={currentFY ?? null}
        initialAllocations={allocations}
        initialTransactions={transactions}
        bands={bands}
      />
      <BottomNav />
    </>
  )
}
