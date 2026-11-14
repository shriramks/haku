'use client'
import type { ReactNode } from 'react'
import { Num } from '@/components/Num'
import { ChevronRightIcon } from '@/components/icons'
import { RowShell, RowSymbol } from '@/components/StockListRow'
import { ProgressBar } from '@/components/ProgressBar'
import { usePersistedState } from '@/lib/use-persisted-state'
import { SLEEVE_LABEL } from '@/lib/sleeves'
import type { AllocationLine, AllocationSectionData } from '@/lib/allocation-sections'

/** Left | Invested columns, shared by the column heads, the section header and every row so the numbers line up. */
export const ALLOCATION_COLS = '1.4fr 1fr 1.2fr'

/**
 * A sleeve's section: a header (the strip, one step down: its Left and Invested) that collapses its rows.
 * The header's % are whole numbers, like the rows': at 19px bold a one-decimal % ("3.88 L 4.6%") fills the Left column
 * and touches the Invested one.
 * The header pins under the page header and the strip while its rows scroll (`--alloc-pin` is their height).
 */
export function AllocationSection({ section, children }: { section: AllocationSectionData; children: ReactNode }) {
  // Remembered per device, like the Plan sections.
  const [state, setState] = usePersistedState<string>(`haku_alloc_${section.sleeve}`, 'open', (v): v is string => v === 'open' || v === 'closed')
  const open = state === 'open'
  return (
    <div>
      <button
        onClick={() => setState(open ? 'closed' : 'open')}
        className="block w-full text-left sticky z-[5] backdrop-blur-xl"
        style={{ top: 'var(--alloc-pin, 0px)', background: 'var(--bg-nav)', paddingTop: 16, paddingBottom: 2, minHeight: 44 }}>
        <div className="grid px-4" style={{ gridTemplateColumns: ALLOCATION_COLS, alignItems: 'center' }}>
          <span className="text-title-1 font-bold truncate" style={{ color: 'var(--text-primary)' }}>{SLEEVE_LABEL[section.sleeve]}</span>
          <p className="text-center text-title-1 font-bold tabnum" style={{ color: 'var(--text-primary)' }}>
            <Num amount={Math.max(0, section.remaining)} />
            <span className="text-footnote ml-2 font-normal" style={{ color: 'var(--text-muted)' }}><Num pct={Math.round(section.pctLeft)} /></span>
          </p>
          <div className="flex items-center justify-end gap-1">
            <p className="text-right text-title-1 font-bold tabnum" style={{ color: 'var(--text-primary)' }}>
              <Num amount={section.invested} />
              <span className="text-footnote ml-2 font-normal" style={{ color: 'var(--text-muted)' }}><Num pct={Math.round(section.pctInvested)} /></span>
            </p>
            <ChevronRightIcon className={`w-4 h-4 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
          </div>
        </div>
      </button>
      {open && children}
    </div>
  )
}

/** One row of a section: a step below its header (semibold name, 15px numbers, thin bar), no caret — the row taps. */
export function AllocationRowView({ line }: { line: AllocationLine }) {
  const isDone = line.remaining <= 0
  // Invested % pairs with the currentCost amount (and the bar fill); Left % pairs with the remaining amount.
  // Different bases — they need not sum to 100.
  const investedPct = line.budget > 0 ? Math.min(100, Math.round((line.currentCost / line.budget) * 100)) : 100
  const leftPct = line.budget > 0 ? Math.max(0, Math.round((line.remaining / line.budget) * 100)) : 0
  return (
    <RowShell href={line.href} dim={isDone}>
      <div className="grid" style={{ gridTemplateColumns: ALLOCATION_COLS, alignItems: 'baseline' }}>
        <div className="min-w-0 pr-1">
          <RowSymbol symbol={line.name} semibold />
        </div>

        <div className="text-center">
          {isDone ? (
            <p className="text-subheadline tabnum" style={{ color: 'var(--text-faint)' }}>Complete</p>
          ) : (
            <p className="text-headline tabnum" style={{ color: 'var(--text-2)' }}>
              <span className="font-medium"><Num amount={line.remaining} /></span>
              <span className="text-footnote ml-1.5" style={{ color: 'var(--text-muted)' }}><Num pct={leftPct} /></span>
            </p>
          )}
        </div>

        {/* No caret: the slot keeps Invested aligned with the section header's. */}
        <div className="flex items-start justify-end gap-1">
          <p className="text-right text-headline tabnum" style={{ color: 'var(--text-primary)' }}>
            <span className="font-semibold"><Num amount={line.currentCost} /></span>
            {!isDone && <span className="text-footnote ml-1.5" style={{ color: 'var(--text-muted)' }}><Num pct={investedPct} /></span>}
          </p>
          <span className="w-4 h-4 flex-shrink-0" />
        </div>
      </div>
      <ProgressBar percent={investedPct} color={isDone ? 'var(--border-faint)' : 'var(--c-positive)'} height={6} className="mt-3" />
    </RowShell>
  )
}
