// Pure helpers for the Portfolio holdings lists (Stocks, MF) — sort order and the return metric
// a row shows. No React, no server imports. See progress log #121.a.

export type SortKey = 'value' | 'pnl' | 'xirr' | 'day' | 'name'
export type SortDir = 'asc' | 'desc'
export interface SortState { key: SortKey; dir: SortDir }

/** Menu order. `defaultDir` is the direction a key starts in when first picked. */
export const SORT_OPTIONS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
  { key: 'value', label: 'Value', defaultDir: 'desc' },
  { key: 'pnl',   label: 'P&L',   defaultDir: 'desc' },
  { key: 'xirr',  label: 'XIRR',  defaultDir: 'desc' },
  { key: 'day',   label: '1D %',  defaultDir: 'desc' },
  { key: 'name',  label: 'Name',  defaultDir: 'asc'  },
]

export const DEFAULT_SORT: SortState = { key: 'value', dir: 'desc' }

/** The fields a holdings row is sorted on. */
export interface SortableHolding {
  name: string
  value: number | null    // current value
  pnl: number | null
  retPct: number | null   // the return the row shows (XIRR, or plain return when XIRR is unavailable)
  dayPct: number | null   // 1D %
}

/** Picking the active key flips its direction; picking another key starts it in its default direction. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
  const option = SORT_OPTIONS.find(o => o.key === key)
  return { key, dir: option ? option.defaultDir : 'desc' }
}

function metric(row: SortableHolding, key: Exclude<SortKey, 'name'>): number | null {
  switch (key) {
    case 'value': return row.value
    case 'pnl':   return row.pnl
    case 'xirr':  return row.retPct
    case 'day':   return row.dayPct
  }
}

/**
 * Returns a sorted copy. Rows with no value for the chosen metric sink to the bottom in
 * either direction (they have nothing to rank on); ties fall back to name A→Z so the order is stable.
 */
export function sortHoldings<T extends SortableHolding>(rows: T[], { key, dir }: SortState): T[] {
  const sign = dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    if (key === 'name') return sign * a.name.localeCompare(b.name)
    const av = metric(a, key)
    const bv = metric(b, key)
    if (av === null && bv === null) return a.name.localeCompare(b.name)
    if (av === null) return 1
    if (bv === null) return -1
    return sign * (av - bv) || a.name.localeCompare(b.name)
  })
}

/**
 * The return figure a row shows: XIRR when there is one, else plain gain ÷ invested (labelled
 * "Return" so the two are never mistaken for each other). `xirr` is a fraction (0.12 = 12%).
 */
export function returnMetric(
  xirr: number | null,
  gain: number | null,
  invested: number,
): { pct: number | null; label: 'XIRR' | 'Return' } {
  if (xirr !== null) return { pct: xirr * 100, label: 'XIRR' }
  return { pct: gain !== null && invested > 0 ? (gain / invested) * 100 : null, label: 'Return' }
}
