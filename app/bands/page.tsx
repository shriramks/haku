import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getFiscalYears, getAllocations, getTransactions, getBuyBands, getBuyTranches } from '@/lib/data'
import { computeStockRows } from '@/lib/compute'
import BandsClient from './BandsClient'
import BottomNav from '@/components/BottomNav'
import UserMenu from '@/components/UserMenu'

export default async function BandsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const fiscalYears = await getFiscalYears()
  const { fy: fyParam } = await searchParams
  const today = new Date()

  const fy = fyParam
    ? (fiscalYears.find(f => f.label === fyParam) ?? fiscalYears[0])
    : (fiscalYears.find(f => new Date(f.start_date) <= today && today <= new Date(f.end_date)) ?? fiscalYears[fiscalYears.length - 1])

  const [allocations, transactions, bands, tranches] = fy
    ? await Promise.all([getAllocations(fy.id), getTransactions(fy.id), getBuyBands(), getBuyTranches(fy.id)])
    : [[], [], [], []]

  const rows = computeStockRows(allocations, transactions, bands, fy?.total_budget_inr ?? 0)

  const sorted = [...rows].sort((a, b) => {
    const aPending = tranches.filter(t => t.symbol === a.symbol && !t.allocated).length
    const bPending = tranches.filter(t => t.symbol === b.symbol && !t.allocated).length
    if (bPending !== aPending) return bPending - aPending
    return a.symbol.localeCompare(b.symbol)
  })

  return (
    <>
      <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {/* Header */}
        <div
          className="sticky top-0 z-10 backdrop-blur-xl border-b px-4 pt-4 pb-3"
          style={{ background: 'var(--bg-nav)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <h1 className="text-[28px] font-bold">Buy Bands</h1>
            <UserMenu />
          </div>
          {fiscalYears.length > 1 && (
            <div className="flex gap-2 mt-2">
              {fiscalYears.map(f => (
                <a key={f.id} href={`/bands?fy=${f.label}`}
                  className="px-3 py-1 rounded-xl text-sm font-medium"
                  style={{
                    background: fy?.id === f.id ? 'var(--text-primary)' : 'var(--border)',
                    color: fy?.id === f.id ? 'var(--bg-primary)' : 'var(--text-muted)',
                  }}>
                  {f.label}
                </a>
              ))}
            </div>
          )}
        </div>

        <BandsClient
          rows={sorted}
          bands={bands}
          allocations={allocations}
          initialTranches={tranches}
          fyId={fy?.id ?? ''}
          fyLabel={fy?.label}
        />
      </div>
      <BottomNav />
    </>
  )
}
