import { getFiscalYears, getAllocations, getCurrentFY } from '@/lib/data'
import PlanClient from './PlanClient'
import BottomNav from '@/components/BottomNav'

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  const fiscalYears = await getFiscalYears()
  const { fy: fyParam } = await searchParams

  const currentFY = getCurrentFY(fiscalYears, fyParam)

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
