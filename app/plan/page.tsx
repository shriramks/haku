import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getFiscalYears, getAllocations, getPlaybook } from '@/lib/data'
import PlanClient from './PlanClient'
import BottomNav from '@/components/BottomNav'

export default async function PlanPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const fiscalYears = await getFiscalYears()

  const today = new Date()
  const currentFY = fiscalYears.find(fy =>
    new Date(fy.start_date) <= today && today <= new Date(fy.end_date)
  ) ?? fiscalYears[0] ?? null

  const [allocations, playbook] = currentFY
    ? await Promise.all([getAllocations(currentFY.id), getPlaybook()])
    : [[], await getPlaybook()]

  return (
    <>
      <PlanClient
        fiscalYears={fiscalYears}
        initialFY={currentFY}
        initialAllocations={allocations}
        initialPlaybook={playbook}
      />
      <BottomNav />
    </>
  )
}
