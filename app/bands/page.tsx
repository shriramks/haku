import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getFiscalYears, getAllocations, getTransactions, getBuyBands } from '@/lib/data'
import { computeStockRows } from '@/lib/data'
import { getBandSignal } from '@/lib/band-calculator'
import { BandSignalBadge } from '@/components/SignalBadge'
import BandRangeBar from '@/components/BandRangeBar'
import BottomNav from '@/components/BottomNav'
import { formatINR } from '@/lib/formatter'

export default async function BandsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const fiscalYears = await getFiscalYears()
  const today = new Date()
  const fy = fiscalYears.find(f => new Date(f.start_date) <= today && today <= new Date(f.end_date)) ?? fiscalYears[0]

  const [allocations, transactions, bands] = fy
    ? await Promise.all([getAllocations(fy.id), getTransactions(fy.id), getBuyBands()])
    : [[], [], []]

  const rows = computeStockRows(allocations, transactions, bands, fy?.total_budget_inr ?? 0)

  // Sort: buy first, then hold, then trim, then unknown
  const signalOrder: Record<string, number> = { buy: 0, deep: 1, hold: 2, trim: 3, unknown: 4 }
  const sorted = [...rows].sort((a, b) =>
    (signalOrder[a.bandSignal] ?? 4) - (signalOrder[b.bandSignal] ?? 4)
  )

  return (
    <>
      <div className="pt-[env(safe-area-inset-top,0px)]">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-white/10">
          <h1 className="text-xl font-bold">Bands</h1>
          {fy && <p className="text-white/40 text-sm">{fy.label} · sorted by signal</p>}
        </div>

        <div>
          {sorted.map(row => {
            const band = bands.find(b => b.symbol === row.symbol)
            const hasBands = band?.buy_low != null && band?.trim_price != null

            return (
              <Link key={row.symbol} href={`/stocks/${row.symbol}?tab=bands`}
                    className="block tap-row border-b border-white/5 px-4 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{row.symbol}</span>
                    <BandSignalBadge signal={row.bandSignal} />
                  </div>
                  <span className="text-white/40 text-sm tabnum">
                    Left: {formatINR(row.remaining)}
                  </span>
                </div>

                {hasBands && band ? (
                  <>
                    <BandRangeBar
                      buyLow={band.buy_low!}  buyHigh={band.buy_high!}
                      midLow={band.mid_low!}  midHigh={band.mid_high!}
                      trimPrice={band.trim_price!}
                      cmp={band.manual_cmp}
                      height={22}
                    />
                    <div className="grid grid-cols-4 gap-1 mt-2">
                      {[
                        { l: 'Buy',  v: `₹${Math.round(band.buy_low!)}–${Math.round(band.buy_high!)}`, c: 'text-green-400' },
                        { l: 'Mid',  v: `₹${Math.round(band.mid_low!)}–${Math.round(band.mid_high!)}`, c: 'text-orange-400' },
                        { l: 'Trim', v: `≥₹${Math.round(band.trim_price!)}`, c: 'text-red-400' },
                        { l: 'CMP',  v: band.manual_cmp ? `₹${Math.round(band.manual_cmp)}` : '—', c: 'text-white/70' },
                      ].map(({ l, v, c }) => (
                        <div key={l}>
                          <p className={`text-xs font-semibold tabnum ${c}`}>{v}</p>
                          <p className="text-white/30 text-[10px]">{l}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-white/30 text-sm">No bands set — tap to add</p>
                )}
              </Link>
            )
          })}
        </div>
      </div>
      <BottomNav />
    </>
  )
}
