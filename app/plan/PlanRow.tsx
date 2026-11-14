'use client'
import { Num } from '@/components/Num'
import { RowShell, RowSymbol } from '@/components/StockListRow'
import { trimPct } from '@/lib/formatter'
import type { Remainder } from '@/lib/sleeves'
import type { StockAllocation } from '@/lib/types'
import { PLAN_COLS } from './SleeveSection'

/** One plan row, one line: its name, its share of the sleeve (blue — the thing you set), its amount. The row taps to edit. */
export function PlanRow({ alloc, budget, onEdit }: {
  alloc: StockAllocation
  /** The row's amount: its share of its sleeve. */
  budget: number
  onEdit: () => void
}) {
  return (
    <RowShell onClick={onEdit}>
      <div className="grid" style={{ gridTemplateColumns: PLAN_COLS, alignItems: 'center' }}>
        <div className="min-w-0 pr-1"><RowSymbol symbol={alloc.kind === 'mf' ? (alloc.name ?? alloc.symbol) : alloc.symbol} /></div>
        <span className="text-center text-headline font-semibold tabnum text-accent">{trimPct(alloc.allocation_pct)}%</span>
        {/* No caret: the slot keeps amounts on the same line as the section header's. */}
        <span className="flex items-center justify-end gap-1">
          <span className="text-headline font-medium tabnum" style={{ color: 'var(--text-2)' }}><Num amount={budget} /></span>
          <span className="w-4 h-4 flex-shrink-0" />
        </span>
      </div>
    </RowShell>
  )
}

/** The line after a set of shares that do not add to 100: what is unassigned, or by how much they overshoot. */
export function RemainderRow({ line }: { line: Remainder }) {
  const over = line.kind === 'over'
  const color = over ? 'var(--c-negative)' : 'var(--text-2)'
  return (
    <div className="grid px-4" style={{ gridTemplateColumns: PLAN_COLS, alignItems: 'center', minHeight: 44 }}>
      <span className="text-body" style={{ color }}>{over ? 'Over' : 'Unassigned'}</span>
      <span className="text-center text-body tabnum" style={{ color }}><Num pct={line.pct} signed={over} /></span>
      <span className="flex items-center justify-end gap-1">
        <span className="text-body tabnum" style={{ color }}><Num amount={line.amount} signed={over} /></span>
        <span className="w-4 h-4 flex-shrink-0" />
      </span>
    </div>
  )
}
