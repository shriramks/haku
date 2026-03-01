import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getFiscalYears, getAllocations } from '@/lib/data'
import SettingsClient from './SettingsClient'
import BottomNav from '@/components/BottomNav'

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const fiscalYears = await getFiscalYears()
  const today = new Date()
  const currentFY = fiscalYears.find(f => new Date(f.start_date) <= today && today <= new Date(f.end_date)) ?? fiscalYears[0]
  const allocations = currentFY ? await getAllocations(currentFY.id) : []

  return (
    <>
      <SettingsClient
        fiscalYears={fiscalYears}
        initialAllocations={allocations}
        userEmail={user.email ?? ''}
      />
      <BottomNav />
    </>
  )
}
