'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { computeStockRows } from '@/lib/compute'
import { BandSignalBadge } from '@/components/SignalBadge'
import AllocationsSheet from '@/components/AllocationsSheet'
import { formatINR, formatPnL, formatPct } from '@/lib/formatter'
import type { FiscalYear, StockAllocation, Transaction, BuyBand } from '@/lib/types'

interface Props {
  fiscalYears: FiscalYear[]
  initialFY: FiscalYear | null
  initialAllocations: StockAllocation[]
  initialTransactions: Transaction[]
  bands: BuyBand[]
}

export default function DashboardClient({ fiscalYears, initialFY, initialAllocations, initialTransactions, bands }: Props) {
  const router = useRouter()
  const [selectedFY, setSelectedFY]     = useState(initialFY)
  const [allocations, setAllocations]   = useState(initialAllocations)
  const [transactions, setTransactions] = useState(initialTransactions)
  const [loading, setLoading]           = useState(false)
  const [showAllocSheet, setShowAllocSheet] = useState(false)

  async function switchFY(fy: FiscalYear) {
    setSelectedFY(fy)
    setLoading(true)
    const sb = getSupabaseBrowser()
    const [{ data: alloc }, { data: txns }] = await Promise.all([
      sb.from('stock_allocations').select('*').eq('fy_id', fy.id).order('allocation_pct', { ascending: false }),
      sb.from('transactions').select('*').eq('fy_id', fy.id).order('trade_date', { ascending: false }),
    ])
    setAllocations(alloc ?? [])
    setTransactions(txns ?? [])
    setLoading(false)
  }

  const rows = useMemo(() =>
    computeStockRows(allocations, transactions, bands, selectedFY?.total_budget_inr ?? 0),
    [allocations, transactions, bands, selectedFY]
  )

  const totalBudget   = selectedFY?.total_budget_inr ?? 0
  const totalDeployed = rows.reduce((s, r) => s + r.spent, 0)
  const totalRemaining = totalBudget - totalDeployed
  const pctDeployed   = totalBudget > 0 ? (totalDeployed / totalBudget) * 100 : 0

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-xl border-b border-white/10
                      pt-[env(safe-area-inset-top,0px)] px-4 pb-3">
        <div className="flex items-center justify-between pt-3">
          <h1 className="text-xl font-bold">Spend Stock</h1>
          <div className="flex items-center gap-2">
            {/* FY selector */}
            {fiscalYears.length > 1 && (
              <div className="flex gap-1">
                {fiscalYears.map(fy => (
                  <button key={fy.id} onClick={() => switchFY(fy)}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors
                      ${selectedFY?.id === fy.id ? 'bg-white text-black' : 'bg-white/10 text-white/60'}`}>
                    {fy.label}
                  </button>
                ))}
              </div>
            )}
            {/* Edit allocations */}
            <button onClick={() => setShowAllocSheet(true)}
              className="px-3 py-1 rounded-lg text-sm font-medium bg-white/8 text-white/50">
              Edit
            </button>
          </div>
        </div>
      </div>

      {/* Summary card */}
      {selectedFY && (
        <div className="mx-4 mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Metric label="Budget"   value={formatINR(totalBudget)} />
            <Metric label="Deployed" value={formatINR(totalDeployed)} />
            <Metric label="Left"     value={formatINR(totalRemaining)}
                    color={totalRemaining < 0 ? 'text-red-400' : 'text-white'} />
          </div>
          {/* Progress bar */}
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pctDeployed > 90 ? 'bg-red-500' :
                pctDeployed > 70 ? 'bg-orange-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, pctDeployed)}%` }}
            />
          </div>
          <p className="text-white/40 text-xs mt-1 tabnum">{formatPct(pctDeployed)} deployed</p>
        </div>
      )}

      {/* Allocations sheet */}
      {showAllocSheet && (
        <AllocationsSheet
          fy={selectedFY}
          onClose={() => { setShowAllocSheet(false); router.refresh() }}
        />
      )}

      {/* Stock list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : (
        <div className="mt-3">
          <p className="px-4 text-xs text-white/30 uppercase tracking-widest mb-2">Holdings</p>
          {rows.map(row => (
            <Link key={row.symbol} href={`/stocks/${row.symbol}`}
                  className="block tap-row border-b border-white/5">
              <div className="px-4 py-3">
                {/* Top row: symbol + buy/deep signal only + alloc target */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base">{row.symbol}</span>
                    {(row.bandSignal === 'buy' || row.bandSignal === 'deep') && (
                      <BandSignalBadge signal={row.bandSignal} />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-white/25 text-[10px] uppercase tracking-wide">alloc</span>
                    <span className="text-white/50 text-xs tabnum">{formatPct(row.allocationPct)}</span>
                  </div>
                </div>

                {/* Deployment bar */}
                <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-1.5">
                  <div
                    className={`h-full rounded-full ${
                      row.pctRemaining > 30 ? 'bg-green-500' :
                      row.pctRemaining > 10 ? 'bg-orange-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, 100 - row.pctRemaining))}%` }}
                  />
                </div>

                {/* Single-line deploy stats */}
                <div className="flex items-center gap-1.5 text-[11px] tabnum mb-1.5">
                  <span className="text-white/50">{formatINR(row.spent)} deployed</span>
                  <span className="text-white/20">·</span>
                  <span className={row.remaining < 0 ? 'text-red-400' : 'text-white/30'}>
                    {formatINR(Math.abs(row.remaining))} {row.remaining < 0 ? 'over' : 'left'}
                  </span>
                  <span className="text-white/20">·</span>
                  <span className={`font-semibold ${
                    row.pctRemaining > 30 ? 'text-white/40' :
                    row.pctRemaining > 10 ? 'text-orange-400' : 'text-red-400'
                  }`}>{formatPct(100 - row.pctRemaining)} deployed</span>
                </div>

                {/* Holdings row */}
                {row.qty > 0 && (
                  <div className="grid grid-cols-4 gap-1 pt-1.5 border-t border-white/5">
                    <SmallMetric label="Held"  value={`${Math.round(row.qty)}`} />
                    <SmallMetric label="Avg"   value={row.avgCost > 0 ? `₹${Math.round(row.avgCost)}` : '—'} />
                    <SmallMetric label="CMP"   value={row.cmp ? `₹${Math.round(row.cmp)}` : '—'} />
                    {row.unrealisedPnL !== null && (
                      <SmallMetric
                        label="P&L"
                        value={formatPnL(row.unrealisedPnL)}
                        color={row.unrealisedPnL >= 0 ? 'text-green-400' : 'text-red-400'}
                      />
                    )}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className={`font-bold tabnum ${color}`}>{value}</p>
      <p className="text-white/40 text-xs mt-0.5">{label}</p>
    </div>
  )
}

function SmallMetric({ label, value, color = 'text-white/70' }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className={`text-xs font-semibold tabnum leading-tight ${color}`}>{value}</p>
      <p className="text-white/30 text-[10px] leading-tight">{label}</p>
    </div>
  )
}
