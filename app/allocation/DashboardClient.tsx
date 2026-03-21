'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { computeStockRows } from '@/lib/compute'
import { formatAmt, formatPct } from '@/lib/formatter'
import type { FiscalYear, StockAllocation, Transaction, BuyBand } from '@/lib/types'
import UserMenu from '@/components/UserMenu'
import FYPicker from '@/components/FYPicker'
import { getStockName } from '@/lib/stock-names'

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
  const [view, setView]                 = useState<'bars' | 'details'>('bars')
  const rows = useMemo(() =>
    computeStockRows(allocations, transactions, bands, selectedFY?.total_budget_inr ?? 0, selectedFY?.id ?? undefined),
    [allocations, transactions, bands, selectedFY]
  )

  async function switchFY(fy: FiscalYear) {
    setSelectedFY(fy)
    setLoading(true)
    router.replace(`/allocation?fy=${encodeURIComponent(fy.label)}`)
    const sb = getSupabaseBrowser()
    const [{ data: alloc }, { data: txns }] = await Promise.all([
      sb.from('stock_allocations').select('*').eq('fy_id', fy.id).order('allocation_pct', { ascending: false }),
      sb.from('transactions').select('*').or(`fy_id.eq.${fy.id},advance_fy_id.eq.${fy.id}`).order('trade_date', { ascending: false }),
    ])
    setAllocations(alloc ?? [])
    setTransactions(txns ?? [])
    setLoading(false)
  }

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

  const stockBudgetTotal = rows.reduce((s, r) => s + r.budget, 0)
  const unallocCarryover = selectedFY?.unallocated_carryover_inr ?? 0
  const totalBudget    = stockBudgetTotal + unallocCarryover
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
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-[28px] font-bold">Allocation</h1>
          <div className="flex items-center gap-2">
            <FYPicker
              fiscalYears={fiscalYears}
              selectedFY={selectedFY}
              onSelect={switchFY}
            />
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Summary strip */}
      {selectedFY && (
        <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Metric label="Budget"    value={formatAmt(totalBudget)} />
            <Metric label="Allocated" value={formatAmt(totalDeployed)} />
            <Metric label="Left"      value={formatAmt(Math.abs(totalRemaining))}
                    negative={totalRemaining < 0} />
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div
              className={`h-full rounded-full transition-all ${
                pctDeployed > 90 ? 'bg-red-500' :
                pctDeployed > 70 ? 'bg-orange-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, pctDeployed)}%` }}
            />
          </div>
          <p className="text-[12px] mt-1 tabnum text-right" style={{ color: 'var(--text-muted)' }}>
            {formatPct(pctDeployed)} deployed
          </p>
        </div>
      )}

      {/* View toggle */}
      {rows.length > 0 && !loading && (
        <div className="flex border-b px-4 gap-1" style={{ borderColor: 'var(--border)' }}>
          {(['bars', 'details'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className="px-3 py-3 text-[15px] font-medium border-b-2 -mb-px transition-colors"
              style={{
                borderColor: view === v ? '#0A84FF' : 'transparent',
                color: view === v ? '#0A84FF' : 'var(--text-muted)',
              }}>
              {v === 'bars' ? 'Allocation' : 'Details'}
            </button>
          ))}
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
      ) : view === 'bars' ? (
        <div className="mt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
          {activeRows.map(row => <BarRow key={row.symbol} row={row} fyLabel={selectedFY?.label ?? ''} />)}
          {completedRows.length > 0 && (
            <>
              <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--border-faint)' }}>
                <span className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-faint)' }}>Completed</span>
              </div>
              {completedRows.map(row => <BarRow key={row.symbol} row={row} fyLabel={selectedFY?.label ?? ''} dim />)}
            </>
          )}
        </div>
      ) : (
        <DetailsTable rows={sortedRows} fyLabel={selectedFY?.label ?? ''} />
      )}
    </div>
  )
}

import type { StockRow } from '@/lib/types'

function BarRow({ row, fyLabel, dim }: { row: StockRow; fyLabel: string; dim?: boolean }) {
  const pct = row.budget > 0 ? Math.min(100, (row.spent / row.budget) * 100) : 0
  const isDone = row.remaining <= 0

  return (
    <Link href={`/stocks/${row.symbol}?fy=${encodeURIComponent(fyLabel)}`}
          className="flex items-center gap-3 px-4 py-4 tap-row border-b"
          style={{ borderColor: 'var(--border-faint)', opacity: dim ? 0.35 : 1 }}>
      <div style={{ width: '108px', flexShrink: 0, overflow: 'hidden' }}>
        <span className="font-semibold text-[17px]">{row.symbol}</span>
        {getStockName(row.symbol) && (
          <p className="text-[11px] truncate" style={{ color: 'var(--text-2)' }}>{getStockName(row.symbol)}</p>
        )}
      </div>
      <div className="flex-1">
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
          <div className={`h-full rounded-full ${
            isDone ? 'bg-gray-400' : pct > 70 ? 'bg-orange-400' : 'bg-green-500'
          }`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="text-[14px] tabnum text-right flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: '64px' }}>
        {isDone ? 'Done' : `${formatAmt(row.remaining)} left`}
      </p>
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
           style={{ color: 'var(--text-faint)' }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}

function DetailsTable({ rows, fyLabel }: { rows: StockRow[]; fyLabel: string }) {
  return (
    <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
      {/* Header row */}
      <div className="grid px-4 py-2 border-b text-[11px] uppercase tracking-widest font-semibold"
           style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', borderColor: 'var(--border)', color: 'var(--text-faint)' }}>
        <span>Stock</span>
        <span className="text-right">Alloc</span>
        <span className="text-right">Spent</span>
        <span className="text-right">Left</span>
        <span className="text-right">Left%</span>
      </div>
      {rows.map(row => {
        const leftPct = row.budget > 0 ? (row.remaining / row.budget) * 100 : 0
        const isOver  = row.remaining < 0
        return (
          <Link key={row.symbol}
            href={`/stocks/${row.symbol}?fy=${encodeURIComponent(fyLabel)}`}
            className="grid px-4 py-3 border-b tap-row tabnum text-[13px]"
            style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', borderColor: 'var(--border-faint)' }}>
            <span className="font-semibold text-[14px]" style={{ color: 'var(--text-primary)' }}>{row.symbol}</span>
            <span className="text-right" style={{ color: 'var(--text-2)' }}>{formatAmt(row.budget)}</span>
            <span className="text-right" style={{ color: 'var(--text-2)' }}>{formatAmt(row.spent)}</span>
            <span className="text-right" style={{ color: isOver ? '#FF3B30' : 'var(--text-2)' }}>
              {isOver ? '−' : ''}{formatAmt(Math.abs(row.remaining))}
            </span>
            <span className="text-right" style={{ color: isOver ? '#FF3B30' : leftPct < 20 ? '#FF9500' : '#30D158' }}>
              {isOver ? `−${Math.abs(leftPct).toFixed(0)}%` : `${leftPct.toFixed(0)}%`}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function Metric({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="text-center">
      <p className="font-bold tabnum text-[22px]" style={{ color: negative ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {value}
      </p>
      <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  )
}
