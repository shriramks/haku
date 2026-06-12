'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { computeStockRows } from '@/lib/compute'
import { getFYData } from '@/app/actions'
import { Num } from '@/components/Num'
import { ChevronRightIcon } from '@/components/icons'
import type { FiscalYear, StockAllocation, Transaction, BuyBand } from '@/lib/types'
import UserMenu from '@/components/UserMenu'
import FYPicker from '@/components/FYPicker'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { ProgressBar } from '@/components/ProgressBar'

interface Props {
  fiscalYears: FiscalYear[]
  initialFY: FiscalYear | null
  initialAllocations: StockAllocation[]
  initialTransactions: Transaction[]
  initialAllTransactions: Transaction[]
  bands: BuyBand[]
}

export default function DashboardClient({ fiscalYears, initialFY, initialAllocations, initialTransactions, initialAllTransactions, bands }: Props) {
  const [selectedFY, setSelectedFY]     = useState(initialFY)
  const [allocations, setAllocations]   = useState(initialAllocations)
  const [transactions, setTransactions] = useState(initialTransactions)
  const [loading, setLoading]           = useState(false)

  const rows = useMemo(() =>
    computeStockRows(
      allocations, transactions, bands,
      (selectedFY?.total_budget_inr ?? 0) + (selectedFY?.unallocated_carryover_inr ?? 0),
      initialAllTransactions,
    ),
    [allocations, transactions, bands, selectedFY, initialAllTransactions]
  )

  async function switchFY(fy: FiscalYear) {
    setSelectedFY(fy)
    setLoading(true)
    window.history.replaceState(null, '', `/allocation?fy=${encodeURIComponent(fy.label)}`)

    const { allocations: alloc, transactions: txns } = await getFYData(fy.id)
    setAllocations(alloc)
    setTransactions(txns)
    setLoading(false)
  }

  const sortedRows = useMemo(() =>
    [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [rows]
  )

  // Invested pairs (amount + %) come from currentCost; Left pairs from
  // budget − spent. Different measures by design (see app-spec investment
  // math), so the two percentages need not sum to 100.
  const { totalBudget, totalDeployed, totalRemaining, pctDeployed, pctLeft } = useMemo(() => {
    const totalBudget    = rows.reduce((s, r) => s + r.budget, 0)
    const totalDeployed  = rows.reduce((s, r) => s + r.currentCost, 0)
    const totalRemaining = totalBudget - rows.reduce((s, r) => s + r.spent, 0)
    return {
      totalBudget,
      totalDeployed,
      totalRemaining,
      pctDeployed: totalBudget > 0 ? (totalDeployed / totalBudget) * 100 : 0,
      pctLeft: totalBudget > 0 ? (Math.max(0, totalRemaining) / totalBudget) * 100 : 0,
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

      {/* Summary strip — Plan | Left | Invested + bar */}
      {selectedFY && (() => {
        return (
          <div className="px-4 pt-4 pb-3 border-b" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-faint)' }}>
            {/* Three stat columns, top-aligned */}
            <div className="grid mb-3" style={{ gridTemplateColumns: '1fr 1px 1fr 1px 1fr', alignItems: 'start' }}>

              {/* Plan — tappable, navigates to /plan */}
              <Link href="/plan" className="flex flex-col gap-0.5" style={{ minHeight: 44, justifyContent: 'center' }}>
                <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Plan</p>
                <p className="text-title-2 font-bold tabnum" style={{ marginTop: 2 }}>
                  <Num amount={totalBudget} />
                </p>
                <span className="flex items-center gap-0.5" style={{ marginTop: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}>Edit plan</span>
                  <ChevronRightIcon className="w-2.5 h-2.5" style={{ color: 'var(--accent)' }} />
                </span>
              </Link>

              <div style={{ width: 1, height: 44, background: 'var(--border-faint)' }} />

              {/* Left */}
              <div className="flex flex-col gap-0.5 items-center">
                <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Left</p>
                <p className="text-title-2 font-bold tabnum" style={{ marginTop: 2 }}>
                  <Num amount={Math.max(0, totalRemaining)} />
                </p>
                <p className="text-footnote tabnum" style={{ color: 'var(--text-muted)', marginTop: 1 }}>
                  <Num pct={pctLeft} />
                </p>
              </div>

              <div style={{ width: 1, height: 44, background: 'var(--border-faint)' }} />

              {/* Invested */}
              <div className="flex flex-col gap-0.5 items-end">
                <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Invested</p>
                <p className="text-title-2 font-bold tabnum" style={{ marginTop: 2 }}>
                  <Num amount={totalDeployed} />
                </p>
                <p className="text-footnote tabnum" style={{ color: 'var(--text-muted)', marginTop: 1 }}>
                  <Num pct={pctDeployed} />
                </p>
              </div>

            </div>

            {/* Progress bar — invested portion */}
            <ProgressBar percent={Math.min(100, pctDeployed)} />
          </div>
        )
      })()}

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
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
            {sortedRows.map(row => <AllocationRow key={row.symbol} row={row} fyLabel={selectedFY?.label ?? ''} dim={row.remaining <= 0} />)}
          </div>

          <div style={{ height: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }} />
        </div>
      )}
    </div>
  )
}

import type { StockRow } from '@/lib/types'

function AllocationRow({ row, fyLabel, dim }: { row: StockRow; fyLabel: string; dim?: boolean }) {
  const isDone      = row.remaining <= 0
  // Invested % pairs with the currentCost amount below (and the bar fill);
  // Left % pairs with the remaining (budget − spent) amount. Different bases —
  // they need not sum to 100.
  const investedPct = row.budget > 0 ? Math.min(100, Math.round((row.currentCost / row.budget) * 100)) : 100
  const leftPct     = row.budget > 0 ? Math.max(0, Math.round((row.remaining / row.budget) * 100)) : 0
  return (
    <Link href={`/stocks/${row.symbol}?fy=${encodeURIComponent(fyLabel)}`}
          className="block px-4 tap-row"
          style={{ opacity: dim ? 0.35 : 1 }}>

      <div className="grid pt-5 pb-3" style={{ gridTemplateColumns: '1.4fr 1fr 1.2fr' }}>
        {/* Col 1 — ticker + company name (truncated to one line) */}
        <div className="min-w-0 pr-1">
          <p className="text-headline font-medium truncate" style={{ color: 'var(--text-primary)' }}>{row.symbol}</p>
        </div>

        {/* Col 2 — Left (secondary) */}
        <div className="text-center">
          {isDone ? (
            <p className="text-subheadline tabnum" style={{ color: 'var(--text-faint)' }}>Complete</p>
          ) : (
            <>
              <p className="text-body tabnum font-medium" style={{ color: 'var(--text-2)' }}>
                <Num amount={row.remaining} />
              </p>
              <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}><Num pct={leftPct} /></p>
            </>
          )}
        </div>

        {/* Col 3 — Invested (primary, matches bar) + chevron */}
        <div className="flex items-start justify-end gap-1">
          <div className="text-right">
            <p className="text-headline font-bold tabnum" style={{ color: 'var(--text-primary)' }}>
              <Num amount={row.currentCost} />
            </p>
            {!isDone && <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}><Num pct={investedPct} /></p>}
          </div>
          <ChevronRightIcon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }} />
        </div>
      </div>

      {/* Bar — rounded, full-width, serves as row divider */}
      <ProgressBar percent={investedPct} color={isDone ? 'var(--border-faint)' : 'var(--c-positive)'} height={6} className="mb-0" />
    </Link>
  )
}


