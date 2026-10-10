import { getFiscalYears, getPlanAllocations, getCurrentFY } from '@/lib/data'
import PlanClient from './PlanClient'

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  const fiscalYears = await getFiscalYears()
  const { fy: fyParam } = await searchParams

  const currentFY = getCurrentFY(fiscalYears, fyParam)

  const allocations = currentFY ? await getPlanAllocations(currentFY.id) : []

  return (
    <>
      <PlanClient
        fiscalYears={fiscalYears}
        initialFY={currentFY}
        initialAllocations={allocations}
      />
    </>
  )
}
