'use client'
import type { ReactNode } from 'react'
import { Num } from '@/components/Num'
import { ChevronRightIcon } from '@/components/icons'
import { trimPct } from '@/lib/formatter'
import { usePersistedState } from '@/lib/use-persisted-state'
import { SLEEVE_LABEL, round1, type Sleeve } from '@/lib/sleeves'

/**
 * The badge beside a sleeve's name: how much of the sleeve its rows leave unassigned, or by how much they
 * overshoot it. Nothing when the rows fill it exactly, or when the sleeve has no money (0%).
 */
export function sleeveBadge(pct: number, rowsTotal: number): { label: string; tone: 'free' | 'over' } | null {
  if (!(pct > 0) || rowsTotal === 100) return null
  return rowsTotal > 100
    ? { label: `${trimPct(rowsTotal)}% · over`, tone: 'over' }
    : { label: `${trimPct(round1(100 - rowsTotal))}% free`, tone: 'free' }
}

const BADGE_STYLE = {
  free: { cls: 'text-warning', bg: 'rgba(255,149,0,0.12)' },
  over: { cls: 'text-negative', bg: 'rgba(255,59,48,0.12)' },
} as const

/** A sleeve of the plan: a header (name, free badge, its % and amount) that collapses its rows. */
export function SleeveSection({ sleeve, pct, amount, rowsTotal, hasRows, onEditSplit, children }: {
  sleeve: Sleeve
  /** The sleeve's % of the pool. */
  pct: number
  amount: number
  /** Sum of its rows' % (of the sleeve). */
  rowsTotal: number
  hasRows: boolean
  /** Opens the Split sheet — the sleeve % is set there, for all three sleeves together. */
  onEditSplit: () => void
  children: ReactNode
}) {
  // Remembered per device, like the Tax sections.
  const [state, setState] = usePersistedState<string>(`haku_plan_${sleeve}`, 'open', (v): v is string => v === 'open' || v === 'closed')
  const open = state === 'open'
  const toggle = () => { if (hasRows) setState(open ? 'closed' : 'open') }
  const badge = sleeveBadge(pct, rowsTotal)
  const style = badge ? BADGE_STYLE[badge.tone] : null

  return (
    <div>
      <div className="flex items-center gap-2 px-4" style={{ paddingTop: 6 }}>
        <button onClick={toggle} className="flex items-center gap-2 text-left" style={{ minHeight: 44 }}>
          <span className="text-title-1 font-bold" style={{ color: 'var(--text-primary)' }}>{SLEEVE_LABEL[sleeve]}</span>
          {badge && style && (
            <span className={`text-footnote font-bold tabnum ${style.cls}`}
                  style={{ background: style.bg, borderRadius: 20, padding: '2px 8px' }}>
              {badge.label}
            </span>
          )}
        </button>
        <span className="flex-1" />
        <button onClick={onEditSplit} className="text-headline font-semibold tabnum text-accent text-right"
                style={{ minHeight: 44, minWidth: 44 }}>
          {trimPct(pct)}%
        </button>
        <button onClick={toggle} className="flex items-center justify-end gap-2" style={{ minHeight: 44 }}>
          <span className="text-headline font-semibold tabnum text-right" style={{ minWidth: 48 }}><Num amount={amount} /></span>
          {hasRows
            ? <ChevronRightIcon className={`w-4 h-4 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
            : <span className="w-4 h-4 flex-shrink-0" />}
        </button>
      </div>
      {open && children}
    </div>
  )
}
