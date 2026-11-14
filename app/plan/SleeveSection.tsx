'use client'
import type { ReactNode } from 'react'
import { Num } from '@/components/Num'
import { ChevronRightIcon } from '@/components/icons'
import { trimPct } from '@/lib/formatter'
import { usePersistedState } from '@/lib/use-persisted-state'
import { SLEEVE_LABEL, type Sleeve } from '@/lib/sleeves'

/**
 * The Plan screen's one grid — the same columns as Allocation: name | share (centred) | amount (right). Every
 * line of the screen (sleeve header, row, unassigned line, column heads) uses it, so shares and amounts line up
 * all the way down. A share is always its share of its parent: a sleeve of the pool, a row of its sleeve.
 */
export const PLAN_COLS = '1.4fr 1fr 1.2fr'

/** A sleeve of the plan: a header that opens the split, with a caret that collapses its rows. */
export function SleeveSection({ sleeve, pct, amount, hasRows, onEditSplit, children }: {
  sleeve: Sleeve
  /** The sleeve's % of the pool. */
  pct: number
  amount: number
  hasRows: boolean
  /** Opens the Split sheet — tapping the header edits the sleeve %, set there for all three sleeves together. */
  onEditSplit: () => void
  children: ReactNode
}) {
  // Remembered per device, like the Tax sections.
  const [state, setState] = usePersistedState<string>(`haku_plan_${sleeve}`, 'open', (v): v is string => v === 'open' || v === 'closed')
  const open = state === 'open'
  const toggle = () => { if (hasRows) setState(open ? 'closed' : 'open') }

  return (
    <div>
      <div className="relative" style={{ paddingTop: 6 }}>
        {/* Name, share and amount are one tap target: edit the split. The slot at the right is where the caret sits. */}
        <button onClick={onEditSplit} className="grid w-full px-4 text-left"
                style={{ gridTemplateColumns: PLAN_COLS, alignItems: 'center', minHeight: 44 }}>
          <span className="text-title-1 font-bold truncate" style={{ color: 'var(--text-primary)' }}>{SLEEVE_LABEL[sleeve]}</span>
          <span className="text-center text-title-1 font-bold tabnum text-accent">{trimPct(pct)}%</span>
          <span className="flex items-center justify-end gap-1">
            <span className="text-title-1 font-bold tabnum" style={{ color: 'var(--text-primary)' }}><Num amount={amount} /></span>
            <span className="w-4 h-4 flex-shrink-0" />
          </span>
        </button>
        {/* Only the caret collapses: a 44px hit area centred on the slot (24px in from the edge). */}
        {hasRows && (
          <button
            onClick={toggle}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${SLEEVE_LABEL[sleeve]}`}
            className="absolute flex items-center justify-center"
            style={{ right: 2, top: 6, width: 44, height: 44 }}>
            <ChevronRightIcon className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>
      {open && children}
    </div>
  )
}
