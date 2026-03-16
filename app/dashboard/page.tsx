import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getFiscalYears, getAllocations, getTransactions, getBuyBands } from '@/lib/data'
import dynamic from 'next/dynamic'
const DashboardClient = dynamic(() => import('./DashboardClient'), {
  loading: () => (
    <div className="px-4 pt-4 space-y-3">
      <div className="h-8 w-40 rounded-xl animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
      <div className="h-28 rounded-2xl animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
      ))}
    </div>
  ),
})
import BottomNav from '@/components/BottomNav'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
