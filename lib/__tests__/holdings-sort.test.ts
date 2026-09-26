import { describe, it, expect } from 'vitest'
import { sortHoldings, nextSort, returnMetric, DEFAULT_SORT, SORT_OPTIONS, type SortableHolding } from '../holdings-sort'

const row = (name: string, o: Partial<SortableHolding> = {}): SortableHolding =>
  ({ name, value: null, pnl: null, retPct: null, dayPct: null, ...o })

const names = (rows: SortableHolding[]) => rows.map(r => r.name)

describe('sortHoldings', () => {
  const rows = [
    row('B', { value: 200, pnl: -10, retPct: 5,  dayPct: 0.5 }),
    row('A', { value: 500, pnl: 40,  retPct: 12, dayPct: -0.2 }),
    row('C', { value: 100, pnl: 90,  retPct: -3, dayPct: 1.4 }),
  ]

  it('default sort is value, largest first', () => {
    expect(names(sortHoldings(rows, DEFAULT_SORT))).toEqual(['A', 'B', 'C'])
  })

  it('sorts each numeric key, descending then ascending', () => {
    expect(names(sortHoldings(rows, { key: 'pnl', dir: 'desc' }))).toEqual(['C', 'A', 'B'])
    expect(names(sortHoldings(rows, { key: 'pnl', dir: 'asc' }))).toEqual(['B', 'A', 'C'])
    expect(names(sortHoldings(rows, { key: 'xirr', dir: 'desc' }))).toEqual(['A', 'B', 'C'])
    expect(names(sortHoldings(rows, { key: 'day', dir: 'desc' }))).toEqual(['C', 'B', 'A'])
  })

  it('sorts by name A→Z and Z→A', () => {
    expect(names(sortHoldings(rows, { key: 'name', dir: 'asc' }))).toEqual(['A', 'B', 'C'])
    expect(names(sortHoldings(rows, { key: 'name', dir: 'desc' }))).toEqual(['C', 'B', 'A'])
  })

  it('rows with no value for the metric sink to the bottom in either direction', () => {
    const withGap = [row('X'), ...rows]
    expect(names(sortHoldings(withGap, { key: 'value', dir: 'desc' }))).toEqual(['A', 'B', 'C', 'X'])
    expect(names(sortHoldings(withGap, { key: 'value', dir: 'asc' }))).toEqual(['C', 'B', 'A', 'X'])
  })

  it('ties (and all-empty metrics) fall back to name A→Z, whichever direction', () => {
    const ties = [row('Z', { value: 1 }), row('M', { value: 1 }), row('Q')]
    expect(names(sortHoldings(ties, { key: 'value', dir: 'desc' }))).toEqual(['M', 'Z', 'Q'])
    expect(names(sortHoldings(ties, { key: 'value', dir: 'asc' }))).toEqual(['M', 'Z', 'Q'])
    expect(names(sortHoldings([row('b'), row('a')], { key: 'pnl', dir: 'desc' }))).toEqual(['a', 'b'])
  })

  it('treats 0 as a real value, not as missing', () => {
    const r = [row('N'), row('Zero', { pnl: 0 }), row('Neg', { pnl: -5 })]
    expect(names(sortHoldings(r, { key: 'pnl', dir: 'desc' }))).toEqual(['Zero', 'Neg', 'N'])
  })

  it('does not mutate the input', () => {
    const copy = [...rows]
    sortHoldings(rows, { key: 'name', dir: 'desc' })
    expect(rows).toEqual(copy)
  })
})

describe('nextSort', () => {
  it('picking the active key flips its direction', () => {
    expect(nextSort({ key: 'value', dir: 'desc' }, 'value')).toEqual({ key: 'value', dir: 'asc' })
    expect(nextSort({ key: 'value', dir: 'asc' }, 'value')).toEqual({ key: 'value', dir: 'desc' })
  })

  it('picking another key starts it in its default direction (name ascending, the rest descending)', () => {
    expect(nextSort({ key: 'value', dir: 'asc' }, 'pnl')).toEqual({ key: 'pnl', dir: 'desc' })
    expect(nextSort({ key: 'value', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })

  it('every menu option resolves to a direction', () => {
    for (const o of SORT_OPTIONS) expect(nextSort({ key: 'value', dir: 'desc' }, o.key).key).toBe(o.key)
  })
})

describe('returnMetric', () => {
  it('uses XIRR (as a percentage) when there is one', () => {
    const up = returnMetric(0.1091, 500, 1000)
    expect(up.label).toBe('XIRR')
    expect(up.pct).toBeCloseTo(10.91, 10)
    const down = returnMetric(-0.041, -20, 1000)
    expect(down.label).toBe('XIRR')
    expect(down.pct).toBeCloseTo(-4.1, 10)
  })

  it('falls back to plain return, labelled Return, when XIRR is unavailable', () => {
    expect(returnMetric(null, 50, 1000)).toEqual({ pct: 5, label: 'Return' })
  })

  it('is null when there is neither XIRR nor a usable gain/invested', () => {
    expect(returnMetric(null, null, 1000)).toEqual({ pct: null, label: 'Return' })
    expect(returnMetric(null, 50, 0)).toEqual({ pct: null, label: 'Return' })
  })

  it('keeps an XIRR of exactly 0 (it is a value, not missing)', () => {
    expect(returnMetric(0, 10, 1000)).toEqual({ pct: 0, label: 'XIRR' })
  })
})
