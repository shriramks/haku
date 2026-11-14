import { fyEndYear } from './fy-utils'

export type YearClass = 'equity' | 'debt' | 'gold'

/** The fields of a Transactions-screen row that the yearly roll-up reads. */
export interface YearTxn {
  asset: 'stock' | 'mf' | 'gold' | 'ppf' | 'epf'
  trade_date: string
  direction: 'in' | 'out' | 'neutral'
  /** INR, always positive. */
  amount: number
  /** MF rows only: picks the fund's Equity / Debt class. */
  fundId?: string
}

export interface YearFigures { in: number; out: number; net: number }

export interface YearRow extends YearFigures {
  /** Calendar year the FY ends in (2026 for FY 25-26); the sort key. */
  fyEnd: number
  /** `FY 25-26`. */
  label: string
  byClass: Record<YearClass, YearFigures>
}

const CLASSES: YearClass[] = ['equity', 'debt', 'gold']

function emptyFigures(): YearFigures { return { in: 0, out: 0, net: 0 } }

/** `FY 25-26` for the FY ending in `fyEnd`. */
export function fyLabel(fyEnd: number): string {
  return `FY ${String((fyEnd - 1) % 100).padStart(2, '0')}-${String(fyEnd % 100).padStart(2, '0')}`
}

/** Same classes as the Portfolio pie: stocks and equity funds are Equity; debt funds, PPF and EPF are Debt; gold of every kind is Gold. */
function classOf(t: YearTxn, fundClass: (fundId: string) => 'equity' | 'debt'): YearClass {
  if (t.asset === 'gold') return 'gold'
  if (t.asset === 'ppf' || t.asset === 'epf') return 'debt'
  if (t.asset === 'mf') return t.fundId ? fundClass(t.fundId) : 'equity'
  return 'equity'
}

/**
 * Money in and out per Indian FY (Apr–Mar, by trade date), newest first, split into
 * Equity / Debt / Gold. `net` = in − out and may be negative: a year of net selling.
 * Rows with no direction (PPF/EPF interest) are neither an investment nor a withdrawal and are skipped.
 * FYs with no rows are not listed.
 */
export function investedByYear(
  txns: YearTxn[],
  fundClass: (fundId: string) => 'equity' | 'debt',
): YearRow[] {
  const byYear = new Map<number, YearRow>()

  for (const t of txns) {
    if (t.direction === 'neutral') continue
    const fyEnd = fyEndYear(new Date(t.trade_date + 'T00:00:00'))
    let row = byYear.get(fyEnd)
    if (!row) {
      row = {
        fyEnd, label: fyLabel(fyEnd), ...emptyFigures(),
        byClass: { equity: emptyFigures(), debt: emptyFigures(), gold: emptyFigures() },
      }
      byYear.set(fyEnd, row)
    }
    const cls = row.byClass[classOf(t, fundClass)]
    const side = t.direction
    row[side] += t.amount
    cls[side] += t.amount
  }

  const rows = Array.from(byYear.values()).sort((a, b) => b.fyEnd - a.fyEnd)
  for (const row of rows) {
    row.net = row.in - row.out
    for (const c of CLASSES) row.byClass[c].net = row.byClass[c].in - row.byClass[c].out
  }
  return rows
}
