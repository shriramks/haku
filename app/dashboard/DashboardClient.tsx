'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { computeStockRows } from '@/lib/compute'
import { BandSignalBadge } from '@/components/SignalBadge'
import { formatINR, formatPnL, formatPct } from '@/lib/formatter'
import type { FiscalYear, StockAllocation, Transaction, BuyBand } from '@/lib/types'
import UserMenu from '@/components/UserMenu'

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

  const totalBudget    = selectedFY?.total_budget_inr ?? 0
  const totalDeployed  = rows.reduce((s, r) => s + r.spent, 0)
  const totalRemaining = totalBudget - totalDeployed
  const pctDeployed    = totalBudget > 0 ? (totalDeployed / totalBudget) * 100 : 0

  return (
    <div className="pb-4">
      {/* Header */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b px-4 pb-3"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 12px)',
        }}>
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-xl font-bold">Allocation</h1>
          <div className="flex items-center gap-2">
            {fiscalYears.length > 1 && (
              <div className="flex gap-1">
                {fiscalYears.map(fy => (
                  <button key={fy.id} onClick={() => switchFY(fy)}
                    className="px-3 py-1 rounded-lg text-sm font-medium transition-colors"
                    style={{
                      background: selectedFY?.id === fy.id ? 'var(--text-primary)' : 'var(--border)',
                      color: selectedFY?.id === fy.id ? 'var(--bg-primary)' : 'var(--text-muted)',
                    }}>
                    {fy.label}
                  </button>
                ))}
              </div>
            )}
            <Link href="/plan"
              className="px-3 py-1 rounded-lg text-sm font-medium"
              style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>
              Edit Plan
            </Link>
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Summary card — full width */}
      {selectedFY && (
        <div className="mx-4 mt-4 p-4 rounded-2xl border"
             style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Metric label="Budget"   value={formatINR(totalBudget)} />
            <Metric label="Deployed" value={formatINR(totalDeployed)} />
            <Metric label="Left"     value={formatINR(totalRemaining)}
                    color={totalRemaining < 0 ? 'text-red-400' : undefined} />
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div
              className={`h-full rounded-full transition-all ${
                pctDeployed > 90 ? 'bg-red-500' :
                pctDeployed > 70 ? 'bg-orange-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, pctDeployed)}%` }}
            />
          </div>
          <p className="text-xs mt-1 tabnum" style={{ color: 'var(--text-muted)' }}>
            {formatPct(pctDeployed)} deployed
          </p>
        </div>
      )}

      {/* Stock list — single column mobile, two column on md+ */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 rounded-full animate-spin"
               style={{ borderColor: 'var(--border)', borderTopColor: 'var(--text-primary)' }} />
        </div>
      ) : (
        <div className="mt-3">
          <p className="px-4 text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
            Holdings
          </p>
          <div className="md:grid md:grid-cols-2 md:gap-3 md:px-4">
            {[...rows].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(row => (
              <Link key={row.symbol} href={`/stocks/${row.symbol}`}
                    className="block tap-row border-b md:border md:rounded-2xl md:mb-0"
                    style={{ borderColor: 'var(--border-faint)' }}>
                <div className="px-4 py-3 md:px-4 md:py-3.5">
                  {/* Top row */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-base">{row.symbol}</span>
                      {(row.bandSignal === 'buy' || row.bandSignal === 'deep') && (
                        <BandSignalBadge signal={row.bandSignal} />
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>alloc</span>
                      <span className="text-xs tabnum" style={{ color: 'var(--text-muted)' }}>{formatPct(row.allocationPct)}</span>
                    </div>
                  </div>

                  {/* Deployment bar */}
                  <div className="h-1 rounded-full overflow-hidden mb-1.5" style={{ background: 'var(--border)' }}>
                    <div
                      className={`h-full rounded-full ${
                        row.pctRemaining > 30 ? 'bg-green-500' :
                        row.pctRemaining > 10 ? 'bg-orange-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, 100 - row.pctRemaining))}%` }}
                    />
                  </div>

                  {/* Deploy stats */}
                  <div className="flex items-center gap-1.5 text-[11px] tabnum mb-1.5">
                    <span style={{ color: 'var(--text-2)' }}>{formatINR(row.spent)} deployed</span>
                    <span style={{ color: 'var(--text-faint)' }}>·</span>
                    <span className={row.remaining < 0 ? 'text-red-400' : ''} style={row.remaining >= 0 ? { color: 'var(--text-muted)' } : undefined}>
                      {formatINR(Math.abs(row.remaining))} {row.remaining < 0 ? 'over' : 'left'}
                    </span>
                  </div>

                  {/* Holdings row */}
                  {row.qty > 0 && (
                    <div className="grid grid-cols-4 gap-1 pt-1.5 border-t" style={{ borderColor: 'var(--border-faint)' }}>
                      <SmallMetric label="Held"  value={`${Math.round(row.qty)}`} />
                      <SmallMetric label="Avg"   value={row.avgCost > 0 ? `₹${Math.round(row.avgCost)}` : '—'} />
                      <SmallMetric label="CMP"   value={row.cmp ? `₹${Math.round(row.cmp)}` : '—'} />
                      {row.unrealisedPnL !== null && (
                        <SmallMetric
                          label="P&L"
                          value={formatPnL(row.unrealisedPnL)}
                          color={row.unrealisedPnL >= 0 ? '#22c55e' : '#ef4444'}
                        />
                      )}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {rows.length === 0 && (
            <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
              <p className="text-[17px] font-medium mb-1">No stocks in this plan</p>
              <Link href="/plan" className="text-[15px] text-[#0A84FF]">Add stocks in Plan →</Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className={`font-bold tabnum ${color ?? ''}`} style={color ? undefined : { color: 'var(--text-primary)' }}>
        {value}
      </p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  )
}

function SmallMetric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold tabnum leading-tight" style={{ color: color ?? 'var(--text-2)' }}>{value}</p>
      <p className="text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  )
}
