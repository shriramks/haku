'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { computeStockRows, computeCarryover } from '@/lib/compute'
import { getFYData } from '@/app/actions'
import type { CarryoverResult } from '@/lib/compute'
import { formatAmt, formatINR, formatINRFull } from '@/lib/formatter'
import { ChevronRightIcon } from '@/components/icons'
import { getStockName } from '@/lib/stock-names'
import type { FiscalYear, StockAllocation, Transaction, BuyBand } from '@/lib/types'
import UserMenu from '@/components/UserMenu'
import FYPicker from '@/components/FYPicker'

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

    const { allocations: alloc, transactions: txns, prevAllocations: pAlloc, prevTransactions: pTxns } =
      await getFYData(fy.id, pFY?.id ?? null)
    setAllocations(alloc)
    setTransactions(txns)
    setPrevFY(pFY ?? null)
    setPrevAllocations(pAlloc)
    setPrevTransactions(pTxns)
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
  const activeRows    = useMemo(() => sortedRows.filter(r => r.remaining > 0), [sortedRows])
  const completedRows = useMemo(() => sortedRows.filter(r => r.remaining <= 0), [sortedRows])

  const { totalBudget, totalDeployed, totalRemaining, pctDeployed } = useMemo(() => {
    const totalBudget   = rows.reduce((s, r) => s + r.budget, 0)
    const totalDeployed = rows.reduce((s, r) => s + r.spent, 0)
    return {
      totalBudget,
      totalDeployed,
      totalRemaining: totalBudget - totalDeployed,
      pctDeployed: totalBudget > 0 ? (totalDeployed / totalBudget) * 100 : 0,
    }
  }, [rows])

  return (
    <div style={{ minHeight: '100dvh' }}>
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
        <div className="px-4 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <p className="text-footnote font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Total Plan</p>
          <p className="font-bold tabnum mb-4" style={{ fontSize: '34px', letterSpacing: '-1px' }}>
            {formatINRFull(totalBudget)}
          </p>
          <div className="flex justify-between mb-2">
            <div>
              <p className="text-footnote font-bold uppercase mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.07em' }}>Left</p>
              <p className="font-bold tabnum" style={{ fontSize: '20px', letterSpacing: '-0.5px', color: 'var(--c-positive)' }}>
                {formatINRFull(Math.max(0, totalRemaining))}
                <span className="font-normal ml-1.5" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {(100 - pctDeployed).toFixed(1)}%
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-footnote font-bold uppercase mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.07em' }}>Invested</p>
              <p className="font-bold tabnum" style={{ fontSize: '20px', letterSpacing: '-0.5px' }}>
                {formatINRFull(totalDeployed)}
                <span className="font-normal ml-1.5" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {pctDeployed.toFixed(1)}%
                </span>
              </p>
            </div>
          </div>
          <div className="rounded-full overflow-hidden" style={{ height: '10px', background: 'var(--border-faint)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, pctDeployed)}%`, background: 'var(--bar-fill)' }} />
          </div>
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
        <div>
          {/* Column headers */}
          <div className="grid px-4 pt-4 pb-1"
               style={{ gridTemplateColumns: '1.4fr 1fr 1.2fr' }}>
            <span className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Stock</span>
            <span className="text-footnote font-bold uppercase text-center" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Left</span>
            <span className="text-footnote font-bold uppercase text-right" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Invested</span>
          </div>
          {/* Flat allocation rows */}
          <div>
            {activeRows.map(row => <AllocationRow key={row.symbol} row={row} fyLabel={selectedFY?.label ?? ''} />)}
            {completedRows.map(row => <AllocationRow key={row.symbol} row={row} fyLabel={selectedFY?.label ?? ''} dim />)}
          </div>

          {/* Carryover breakdown — only when there's a previous FY with data */}
          {carryoverResult && prevFY && (
            carryoverResult.breakdown.orphans.length > 0 ||
            carryoverResult.breakdown.direct.size > 0
          ) && (
            <CollapsibleSection title={`Carryover from ${prevFY.label}`}>
              <CarryoverSection result={carryoverResult} prevFYLabel={prevFY.label} />
            </CollapsibleSection>
          )}
          <div style={{ height: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }} />
        </div>
      )}
    </div>
  )
}

import type { StockRow } from '@/lib/types'

function AllocationRow({ row, fyLabel, dim }: { row: StockRow; fyLabel: string; dim?: boolean }) {
  const isDone   = row.remaining <= 0
  const leftPct  = row.budget > 0 ? Math.round((row.remaining / row.budget) * 100) : 0
  const spentPct = row.budget > 0 ? Math.min(100, Math.round((row.spent / row.budget) * 100)) : 100
  const name     = getStockName(row.symbol)
  return (
    <Link href={`/stocks/${row.symbol}?fy=${encodeURIComponent(fyLabel)}`}
          className="block px-4 tap-row"
          style={{ opacity: dim ? 0.35 : 1 }}>

      <div className="grid pt-5 pb-3" style={{ gridTemplateColumns: '1.4fr 1fr 1.2fr' }}>
        {/* Col 1 — ticker + company name (truncated to one line) */}
        <div className="min-w-0 pr-1">
          <p className="text-headline font-bold" style={{ color: 'var(--text-primary)' }}>{row.symbol}</p>
          {name && <p className="text-footnote mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{name}</p>}
        </div>

        {/* Col 2 — Left (prominent, green) */}
        <div className="text-center">
          {isDone ? (
            <p className="text-subheadline tabnum" style={{ color: 'var(--text-faint)' }}>done</p>
          ) : (
            <>
              <p className="text-headline font-bold tabnum" style={{ color: 'var(--c-positive)' }}>{formatINR(row.remaining)}</p>
              <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>{leftPct}%</p>
            </>
          )}
        </div>

        {/* Col 3 — Invested (secondary) + chevron */}
        <div className="flex items-start justify-end gap-1">
          <div className="text-right">
            <p className="text-body tabnum font-medium" style={{ color: 'var(--text-2)' }}>{formatINR(row.spent)}</p>
            {!isDone && <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>{spentPct}%</p>}
          </div>
          <ChevronRightIcon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }} />
        </div>
      </div>

      {/* Bar — rounded, full-width, serves as row divider */}
      <div className="rounded-full overflow-hidden mb-0" style={{ height: '6px', background: 'var(--border-faint)' }}>
        <div className="h-full rounded-full" style={{ width: `${spentPct}%`, background: 'var(--bar-fill)' }} />
      </div>
    </Link>
  )
}


function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t mt-4" style={{ borderColor: 'var(--border-faint)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full px-4"
        style={{ minHeight: '52px' }}>
        <span className="text-body font-medium" style={{ color: 'var(--text-muted)' }}>{title}</span>
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
  const total = Array.from(result.adjustments.values()).reduce((s, v) => s + v, 0)
  return (
    <div className="px-4 pb-4 space-y-4">
      {/* Total carryover into this FY */}
      <div className="flex justify-between items-center py-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>Total</span>
        <span className={`tabnum text-body font-semibold ${total >= 0 ? 'text-positive' : 'text-negative'}`}>
          {total >= 0 ? '+' : '−'}{formatINR(Math.abs(total))}
        </span>
      </div>
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

