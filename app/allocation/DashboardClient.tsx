'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { computeStockRows, computeCarryover } from '@/lib/compute'
import type { CarryoverResult } from '@/lib/compute'
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
  initialPrevFY: FiscalYear | null
  initialPrevAllocations: StockAllocation[]
  initialPrevTransactions: Transaction[]
  bands: BuyBand[]
}

export default function DashboardClient({ fiscalYears, initialFY, initialAllocations, initialTransactions, initialPrevFY, initialPrevAllocations, initialPrevTransactions, bands }: Props) {
  const router = useRouter()
  const [selectedFY, setSelectedFY]         = useState(initialFY)
  const [allocations, setAllocations]       = useState(initialAllocations)
  const [transactions, setTransactions]     = useState(initialTransactions)
  const [prevFY, setPrevFY]                 = useState(initialPrevFY)
  const [prevAllocations, setPrevAllocations] = useState(initialPrevAllocations)
  const [prevTransactions, setPrevTransactions] = useState(initialPrevTransactions)
  const [loading, setLoading]               = useState(false)

  const carryoverResult = useMemo<CarryoverResult | null>(() => {
    if (!prevFY) return null
    const prevBudget = prevFY.total_budget_inr + (prevFY.unallocated_carryover_inr ?? 0)
    return computeCarryover(prevAllocations, prevTransactions, prevBudget, prevFY.id, allocations)
  }, [prevFY, prevAllocations, prevTransactions, allocations])

  const rows = useMemo(() =>
    computeStockRows(
      allocations, transactions, bands,
      (selectedFY?.total_budget_inr ?? 0) + (selectedFY?.unallocated_carryover_inr ?? 0),
      selectedFY?.id ?? undefined,
      carryoverResult?.adjustments,
    ),
    [allocations, transactions, bands, selectedFY, carryoverResult]
  )

  async function switchFY(fy: FiscalYear) {
    setSelectedFY(fy)
    setLoading(true)
    router.replace(`/allocation?fy=${encodeURIComponent(fy.label)}`)

    const fyIdx = fiscalYears.findIndex(f => f.id === fy.id)
    const pFY   = fyIdx > 0 ? fiscalYears[fyIdx - 1] : null

    const sb = getSupabaseBrowser()
    const [{ data: alloc }, { data: txns }, prevAllocRes, prevTxnRes] = await Promise.all([
      sb.from('stock_allocations').select('*').eq('fy_id', fy.id).order('allocation_pct', { ascending: false }),
      sb.from('transactions').select('*').or(`fy_id.eq.${fy.id},advance_fy_id.eq.${fy.id}`).order('trade_date', { ascending: false }),
      pFY
        ? sb.from('stock_allocations').select('*').eq('fy_id', pFY.id).order('allocation_pct', { ascending: false })
        : Promise.resolve({ data: [] as StockAllocation[] }),
      pFY
        ? sb.from('transactions').select('*').or(`fy_id.eq.${pFY.id},advance_fy_id.eq.${pFY.id}`).order('trade_date', { ascending: false })
        : Promise.resolve({ data: [] as Transaction[] }),
    ])
    setAllocations(alloc ?? [])
    setTransactions(txns ?? [])
    setPrevFY(pFY ?? null)
    setPrevAllocations(prevAllocRes.data ?? [])
    setPrevTransactions(prevTxnRes.data ?? [])
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

  const totalBudget    = rows.reduce((s, r) => s + r.budget, 0)
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
          <h1 className="text-display font-bold">Allocation</h1>
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
                pctDeployed > 90 ? 'bg-negative' :
                pctDeployed > 70 ? 'bg-warning' : 'bg-positive'
              }`}
              style={{ width: `${Math.min(100, pctDeployed)}%` }}
            />
          </div>
          <p className="text-subheadline mt-1 tabnum text-right" style={{ color: 'var(--text-muted)' }}>
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
          <p className="text-headline font-medium mb-1">No stocks in this plan</p>
          <Link href="/plan" className="text-body text-accent">Add stocks in Plan →</Link>
        </div>
      ) : (
        <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
          {/* Allocation bars */}
          <div className="mt-2">
            {activeRows.map(row => <BarRow key={row.symbol} row={row} fyLabel={selectedFY?.label ?? ''} />)}
            {completedRows.length > 0 && (
              <>
                <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--border-faint)' }}>
                  <span className="text-footnote uppercase tracking-widest font-semibold" style={{ color: 'var(--text-faint)' }}>Completed</span>
                </div>
                {completedRows.map(row => <BarRow key={row.symbol} row={row} fyLabel={selectedFY?.label ?? ''} dim />)}
              </>
            )}
          </div>
          {/* Details table — collapsible */}
          <CollapsibleSection title="Details">
            <DetailsTable rows={sortedRows} fyLabel={selectedFY?.label ?? ''} />
          </CollapsibleSection>

          {/* Carryover breakdown — only when there's a previous FY with data */}
          {carryoverResult && prevFY && (
            carryoverResult.breakdown.orphans.length > 0 ||
            carryoverResult.breakdown.direct.size > 0
          ) && (
            <CollapsibleSection title={`Carryover from ${prevFY.label}`}>
              <CarryoverSection result={carryoverResult} prevFYLabel={prevFY.label} />
            </CollapsibleSection>
          )}
        </div>
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
        <span className="font-semibold text-headline" style={{ color: 'var(--text-primary)' }}>{row.symbol}</span>
        {getStockName(row.symbol) && (
          <p className="text-footnote truncate" style={{ color: 'var(--text-faint)' }}>{getStockName(row.symbol)}</p>
        )}
      </div>
      <div className="flex-1">
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
          <div className={`h-full rounded-full ${
            isDone ? 'bg-gray-400' : pct > 70 ? 'bg-warning' : 'bg-positive'
          }`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="text-body tabnum text-right flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: '64px' }}>
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
      <div className="grid px-4 py-2 border-b text-footnote uppercase tracking-widest font-semibold"
           style={{ gridTemplateColumns: '1.2fr 1fr 1.4fr', borderColor: 'var(--border)', color: 'var(--text-faint)' }}>
        <span>Stock</span>
        <span className="text-right">Spent</span>
        <span className="text-right">Left</span>
      </div>
      {rows.map(row => {
        const leftPct = row.budget > 0 ? (row.remaining / row.budget) * 100 : 0
        const isOver  = row.remaining < 0
        const leftColorClass = isOver ? 'text-negative' : leftPct < 20 ? 'text-warning' : 'text-positive'
        return (
          <Link key={row.symbol}
            href={`/stocks/${row.symbol}?fy=${encodeURIComponent(fyLabel)}`}
            className="grid items-center px-4 border-b tap-row tabnum text-subheadline"
            style={{ gridTemplateColumns: '1.2fr 1fr 1.4fr', borderColor: 'var(--border-faint)', minHeight: '52px' }}>
            <span className="font-semibold text-body" style={{ color: 'var(--text-primary)' }}>{row.symbol}</span>
            <span className="text-right" style={{ color: 'var(--text-2)' }}>{formatAmt(row.spent)}</span>
            <span className={`text-right ${leftColorClass}`}>
              {isOver ? '−' : ''}{formatAmt(Math.abs(row.remaining))}
              <span className="text-footnote ml-1">({isOver ? `−${Math.abs(leftPct).toFixed(0)}` : leftPct.toFixed(0)}%)</span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t" style={{ borderColor: 'var(--border-faint)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full px-4"
        style={{ minHeight: '52px' }}>
        <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <svg className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
             style={{ color: 'var(--text-faint)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && children}
    </div>
  )
}

function CarryoverSection({ result, prevFYLabel }: { result: CarryoverResult; prevFYLabel: string }) {
  const { direct, poolTotal, poolShares, orphans } = result.breakdown
  return (
    <div className="px-4 pb-4 space-y-4">
      {/* Orphaned stocks */}
      {orphans.length > 0 && (
        <div>
          <p className="text-footnote uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-faint)' }}>
            Exited in {prevFYLabel}
          </p>
          {orphans.map(o => (
            <div key={o.symbol} className="flex justify-between items-center py-3">
              <span className="text-body" style={{ color: 'var(--text-muted)' }}>{o.symbol}</span>
              <span className={`tabnum text-body ${o.remaining >= 0 ? 'text-positive' : 'text-negative'}`}>
                {o.remaining >= 0 ? '+' : '−'}{formatAmt(Math.abs(o.remaining))} → pool
              </span>
            </div>
          ))}
          <div className="flex justify-between items-center py-3 border-t mt-1" style={{ borderColor: 'var(--border-faint)' }}>
            <span className="text-subheadline font-medium" style={{ color: 'var(--text-muted)' }}>Pool total</span>
            <span className={`tabnum text-subheadline font-medium ${poolTotal >= 0 ? 'text-positive' : 'text-negative'}`}>
              {poolTotal >= 0 ? '+' : '−'}{formatAmt(Math.abs(poolTotal))}
            </span>
          </div>
        </div>
      )}

      {/* Per-stock adjustments */}
      {result.adjustments.size > 0 && (
        <div>
          {Array.from(result.adjustments.entries()).map(([sym, total]) => {
            const d = direct.get(sym) ?? 0
            const p = poolShares.get(sym) ?? 0
            if (total === 0) return null
            return (
              <div key={sym} className="flex justify-between items-center py-3">
                <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{sym}</span>
                <div className="text-right">
                  <span className={`tabnum text-body ${total >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {total >= 0 ? '+' : '−'}{formatAmt(Math.abs(total))}
                  </span>
                  {d !== 0 && p !== 0 && (
                    <p className="text-footnote tabnum" style={{ color: 'var(--text-faint)' }}>
                      {d >= 0 ? '+' : '−'}{formatAmt(Math.abs(d))} direct · {p >= 0 ? '+' : '−'}{formatAmt(Math.abs(p))} pool
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="text-center">
      <p className="font-bold tabnum text-title-1" style={{ color: negative ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {value}
      </p>
      <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  )
}
