import { getFiscalYears, getAllocations } from '@/lib/data'
import PlanClient from './PlanClient'
import BottomNav from '@/components/BottomNav'

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  const fiscalYears = await getFiscalYears()
  const { fy: fyParam } = await searchParams

  const today = new Date()
  const currentFY = fyParam
    ? (fiscalYears.find(f => f.label === fyParam) ?? fiscalYears[0] ?? null)
    : (fiscalYears.find(fy =>
        new Date(fy.start_date) <= today && today <= new Date(fy.end_date)
      ) ?? fiscalYears[0] ?? null)

  const allocations = currentFY ? await getAllocations(currentFY.id) : []

  return (
    <>
      <PlanClient
        fiscalYears={fiscalYears}
        initialFY={currentFY}
        initialAllocations={allocations}
      />
      <BottomNav />
    </>
  )
}
