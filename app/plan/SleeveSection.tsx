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

/** A sleeve of the plan: a header (name, free badge, its % and amount) that opens the split; its caret collapses the rows. */
export function SleeveSection({ sleeve, pct, amount, rowsTotal, hasRows, onEditSplit, children }: {
  sleeve: Sleeve
  /** The sleeve's % of the pool. */
  pct: number
  amount: number
  /** Sum of its rows' % (of the sleeve). */
  rowsTotal: number
  hasRows: boolean
  /** Opens the Split sheet — tapping the header edits the sleeve %, set there for all three sleeves together. */
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
      <div className="flex items-center px-4" style={{ paddingTop: 6 }}>
        {/* Name, badge, % and amount are one tap target: edit the split. */}
        <button onClick={onEditSplit} className="flex flex-1 min-w-0 items-center gap-2 text-left" style={{ minHeight: 44 }}>
          <span className="text-title-1 font-bold" style={{ color: 'var(--text-primary)' }}>{SLEEVE_LABEL[sleeve]}</span>
          {badge && style && (
            <span className={`text-footnote font-bold tabnum ${style.cls}`}
                  style={{ background: style.bg, borderRadius: 20, padding: '2px 8px' }}>
              {badge.label}
            </span>
          )}
          <span className="flex-1" />
          <span className="text-headline font-semibold tabnum text-accent text-right" style={{ minWidth: 44 }}>{trimPct(pct)}%</span>
          <span className="text-headline font-semibold tabnum text-right" style={{ minWidth: 48, color: 'var(--text-primary)' }}><Num amount={amount} /></span>
        </button>
        {/* Only the caret collapses. Its 44px hit area overhangs into the page margin, so its layout footprint is
            32px — the same room a row leaves after its amount (12px gap + 16px slot + 4px), which keeps the amounts aligned. */}
        {hasRows ? (
          <button
            onClick={toggle}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${SLEEVE_LABEL[sleeve]}`}
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: 44, height: 44, marginLeft: 2, marginRight: -14 }}>
            <ChevronRightIcon className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
          </button>
        ) : (
          <span className="flex-shrink-0" style={{ width: 32 }} />
        )}
      </div>
      {open && children}
    </div>
  )
}
