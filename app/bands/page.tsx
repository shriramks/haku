import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getFiscalYears, getAllocations, getTransactions, getBuyBands, getBuyTranches } from '@/lib/data'
import { computeStockRows } from '@/lib/compute'
import BandsClient from './BandsClient'
import BottomNav from '@/components/BottomNav'

export default async function BandsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const fiscalYears = await getFiscalYears()
  const today = new Date()
  const fy = fiscalYears.find(f => new Date(f.start_date) <= today && today <= new Date(f.end_date)) ?? fiscalYears[0]

  const [allocations, transactions, bands, tranches] = fy
    ? await Promise.all([getAllocations(fy.id), getTransactions(fy.id), getBuyBands(), getBuyTranches()])
    : [[], [], [], []]

  const rows = computeStockRows(allocations, transactions, bands, fy?.total_budget_inr ?? 0)

  const signalOrder: Record<string, number> = { buy: 0, deep: 1, hold: 2, trim: 3, unknown: 4 }
  const sorted = [...rows].sort((a, b) =>
    (signalOrder[a.bandSignal] ?? 4) - (signalOrder[b.bandSignal] ?? 4)
  )

  return (
    <>
      <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {/* Header */}
        <div
          className="sticky top-0 z-10 backdrop-blur-xl border-b px-4 pt-4 pb-3"
          style={{ background: 'var(--bg-nav)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[28px] font-bold">Buy Bands</h1>
              {fy && (
                <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {fy.label} · sorted by signal
                </p>
              )}
            </div>
          </div>
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
