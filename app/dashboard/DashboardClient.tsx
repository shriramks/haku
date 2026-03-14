'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { computeStockRows } from '@/lib/compute'
import { formatINR, formatPct } from '@/lib/formatter'
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

  const sortedRows = useMemo(() =>
    [...rows].sort((a, b) => {
      const aFull = a.remaining <= 0
      const bFull = b.remaining <= 0
      if (aFull !== bFull) return aFull ? 1 : -1
      return b.pctRemaining - a.pctRemaining || a.symbol.localeCompare(b.symbol)
    }),
    [rows]
  )
  const activeRows    = sortedRows.filter(r => r.remaining > 0)
  const completedRows = sortedRows.filter(r => r.remaining <= 0)

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
                    className="px-3.5 py-2.5 rounded-lg text-[15px] font-medium transition-colors"
                    style={{
                      background: selectedFY?.id === fy.id ? 'var(--text-primary)' : 'var(--border)',
                      color: selectedFY?.id === fy.id ? 'var(--bg-primary)' : 'var(--text-muted)',
                    }}>
                    {fy.label}
                  </button>
                ))}
              </div>
            )}
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Summary card */}
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

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 rounded-full animate-spin"
               style={{ borderColor: 'var(--border)', borderTopColor: 'var(--text-primary)' }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
          <p className="text-[17px] font-medium mb-1">No stocks in this plan</p>
          <Link href="/plan" className="text-[15px] text-[#0A84FF]">Add stocks in Plan →</Link>
        </div>
      ) : (
        <>
          {/* Bar chart */}
          <div className="mt-4">
            <p className="px-4 text-[12px] uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              By Stock
            </p>
            <div className="mx-4 rounded-2xl overflow-hidden divide-y"
                 style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-faint)' }}>
              {activeRows.map(row => <BarRow key={row.symbol} row={row} />)}
              {completedRows.length > 0 && (
                <>
                  <div className="px-4 py-2">
                    <span className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-faint)' }}>Completed</span>
                  </div>
                  {completedRows.map(row => <BarRow key={row.symbol} row={row} dim />)}
                </>
              )}
            </div>
          </div>

          {/* Details table */}
          <div className="mt-4 pb-24">
            <p className="px-4 text-[12px] uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Details
            </p>
            <div className="mx-4 rounded-2xl overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-4 py-2 border-b"
                   style={{ borderColor: 'var(--border-faint)' }}>
                {['Stock', 'Budget', 'Deployed', 'Left'].map(h => (
                  <span key={h} className="text-[11px] uppercase tracking-wide text-right first:text-left"
                        style={{ color: 'var(--text-faint)' }}>{h}</span>
                ))}
              </div>
              {activeRows.map((row, i) => <DetailRow key={row.symbol} row={row} border={i < activeRows.length - 1 || completedRows.length > 0} />)}
              {completedRows.length > 0 && (
                <>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-4 py-2 border-t"
                       style={{ borderColor: 'var(--border-faint)' }}>
                    <span className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-faint)' }}>Completed</span>
                  </div>
                  {completedRows.map((row, i) => <DetailRow key={row.symbol} row={row} border={i < completedRows.length - 1} dim />)}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

import type { StockRow } from '@/lib/types'

function BarRow({ row, dim }: { row: StockRow; dim?: boolean }) {
  const pct = row.budget > 0 ? Math.min(100, (row.spent / row.budget) * 100) : 0
  return (
    <Link href={`/stocks/${row.symbol}`}
          className="grid items-center gap-3 px-4 py-4 tap-row"
          style={{ gridTemplateColumns: '108px 1fr 80px 16px', opacity: dim ? 0.35 : 1 }}>
      <span className="font-semibold text-[16px]">{row.symbol}</span>
      <div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
          <div className={`h-full rounded-full ${
            row.remaining <= 0 ? 'bg-gray-400' : pct > 70 ? 'bg-orange-400' : 'bg-green-500'
          }`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="text-right">
        <p className="text-[15px] font-bold tabnum"
           style={{ color: row.remaining < 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
          {row.remaining < 0 ? '−' : ''}{formatINR(Math.abs(row.remaining))}
        </p>
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {row.remaining < 0 ? 'over' : 'left'}
        </p>
      </div>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
           style={{ color: 'var(--text-faint)' }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}

function DetailRow({ row, border, dim }: { row: StockRow; border: boolean; dim?: boolean }) {
  return (
    <div className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-4 py-3 ${border ? 'border-b' : ''}`}
         style={{ borderColor: 'var(--border-faint)', opacity: dim ? 0.35 : 1 }}>
      <div>
        <p className="font-semibold text-[15px]">{row.symbol}</p>
        {row.qty > 0 && (
          <p className="text-[12px] tabnum" style={{ color: 'var(--text-muted)' }}>{Math.round(row.qty)} sh</p>
        )}
      </div>
      <p className="text-[14px] tabnum text-right self-center" style={{ color: 'var(--text-2)' }}>
        {formatINR(row.budget)}
      </p>
      <p className="text-[14px] tabnum text-right self-center" style={{ color: 'var(--text-2)' }}>
        {formatINR(row.spent)}
      </p>
      <p className="text-[14px] tabnum text-right self-center font-medium"
         style={{ color: row.remaining < 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {row.remaining < 0 ? '−' : ''}{formatINR(Math.abs(row.remaining))}
      </p>
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
