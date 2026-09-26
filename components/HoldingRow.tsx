import { Num } from '@/components/Num'
import { getGainColor } from '@/lib/formatter'
import type { SortableHolding } from '@/lib/holdings-sort'

/**
 * One holding on the Portfolio screen — Stocks, MF and Gold all use it (progress log #121.a).
 * Everything a row shows is precomputed by the caller; this component only lays it out.
 */
export interface HoldingRowData extends SortableHolding {
  key: string
  href: string
  retLabel: 'XIRR' | 'Return'
  /** 1D move. Omitted for holdings with no daily figure (Gold) — `meta` fills the slot instead. */
  day?: { amount: number | null; pct: number | null }
  /** Replaces the 1D line, e.g. Gold's "20g · Mar 2028". */
  meta?: string
  /** MF only — what the Equity / Debt filter pills match on. Not drawn on the row. */
  assetClass?: 'equity' | 'debt'
  /** Shown in place of the "1D" label when this holding's price is older than the rest's (#121.b). */
  staleDate?: string
}

/** Small muted tag ("P&L", "1D") in front of a figure — 13px at text-2, never fainter. */
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-subheadline mr-1.5" style={{ color: 'var(--text-2)' }}>{children}</span>
}

export function HoldingRow({ row, onClick }: { row: HoldingRowData; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="grid w-full text-left tap-row px-4 py-3"
      style={{
        gridTemplateColumns: 'minmax(0,1fr) auto',
        columnGap: 12,
        alignItems: 'start',
        minHeight: 64,
        borderBottom: '1px solid var(--divider)',
      }}>
      <div className="min-w-0">
        <p className="text-headline font-semibold line-clamp-2" style={{ color: 'var(--text-primary)' }}>
          {row.name}
        </p>
        <p className="text-body tabnum mt-0.5 whitespace-nowrap">
          {row.meta !== undefined ? (
            <span style={{ color: 'var(--text-2)' }}>{row.meta}</span>
          ) : (
            <>
              <Tag>{row.staleDate ?? '1D'}</Tag>
              {row.day && row.day.amount !== null ? (
                <span style={{ color: getGainColor(row.day.amount) }}>
                  <Num amount={row.day.amount} signed />
                  <span className="ml-2"><Num pct={row.day.pct} signed /></span>
                </span>
              ) : (
                <span style={{ color: 'var(--text-2)' }}>—</span>
              )}
            </>
          )}
        </p>
      </div>
      <div className="text-right tabnum">
        <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Num amount={row.value} />
        </p>
        <p className="text-body mt-px whitespace-nowrap">
          <Tag>P&amp;L</Tag>
          <span style={{ color: row.pnl !== null ? getGainColor(row.pnl) : 'var(--text-2)' }}>
            <Num amount={row.pnl} signed />
          </span>
        </p>
        <p className="text-body mt-px whitespace-nowrap">
          <Tag>{row.retLabel}</Tag>
          <span style={{ color: row.retPct !== null ? getGainColor(row.retPct) : 'var(--text-2)' }}>
            <Num pct={row.retPct} signed />
          </span>
        </p>
      </div>
    </button>
  )
}
