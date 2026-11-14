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

/**
 * A sleeve of the plan: one header that collapses its rows (the whole header is the target, caret rotating as a
 * disclosure triangle does). The split is edited in the Plan sheet, not here, so the share is plain text. A sleeve
 * with no rows has nothing to open and is not a button.
 */
export function SleeveSection({ sleeve, pct, amount, hasRows, children }: {
  sleeve: Sleeve
  /** The sleeve's % of the pool. */
  pct: number
  amount: number
  hasRows: boolean
  children: ReactNode
}) {
  // Remembered per device, like the Tax sections.
  const [state, setState] = usePersistedState<string>(`haku_plan_${sleeve}`, 'open', (v): v is string => v === 'open' || v === 'closed')
  const open = state === 'open'

  const cells = (
    <>
      <span className="text-title-1 font-bold truncate" style={{ color: 'var(--text-primary)' }}>{SLEEVE_LABEL[sleeve]}</span>
      <span className="text-center text-title-1 font-bold tabnum" style={{ color: 'var(--text-primary)' }}>{trimPct(pct)}%</span>
      <span className="flex items-center justify-end gap-1">
        <span className="text-title-1 font-bold tabnum" style={{ color: 'var(--text-primary)' }}><Num amount={amount} /></span>
        {hasRows
          ? <ChevronRightIcon className={`w-4 h-4 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
          : <span className="w-4 h-4 flex-shrink-0" />}
      </span>
    </>
  )
  const grid = { gridTemplateColumns: PLAN_COLS, alignItems: 'center', minHeight: 44 } as const

  return (
    <div>
      <div style={{ paddingTop: 6 }}>
        {hasRows ? (
          <button onClick={() => setState(open ? 'closed' : 'open')} aria-expanded={open}
                  aria-label={`${SLEEVE_LABEL[sleeve]}, ${open ? 'collapse' : 'expand'}`}
                  className="grid w-full px-4 text-left" style={grid}>{cells}</button>
        ) : (
          <div className="grid w-full px-4" style={grid}>{cells}</div>
        )}
      </div>
      {open && children}
    </div>
  )
}
