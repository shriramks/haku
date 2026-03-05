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

  // Sort: buy first, then deep, then hold, then trim, then unknown
  const signalOrder: Record<string, number> = { buy: 0, deep: 1, hold: 2, trim: 3, unknown: 4 }
  const sorted = [...rows].sort((a, b) =>
    (signalOrder[a.bandSignal] ?? 4) - (signalOrder[b.bandSignal] ?? 4)
  )

  return (
    <>
      <div className="pt-[env(safe-area-inset-top,0px)]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-xl border-b border-white/10 px-4 pt-4 pb-3">
          <h1 className="text-[28px] font-bold">Bands</h1>
          {fy && <p className="text-white/40 text-sm mt-0.5">{fy.label} · sorted by signal</p>}
        </div>

        <BandsClient
          rows={sorted}
          bands={bands}
          initialTranches={tranches}
          fyLabel={fy?.label}
        />
      </div>
      <BottomNav />
    </>
  )
}
