import { PPF_SYMBOL, SLEEVES, rowBudget, sleeveBudget, type Sleeve } from './sleeves'
import type { FiscalYear, StockAllocation, StockRow } from './types'

// The Allocation screen's tree (#180): the strip (whole plan) -> one section per sleeve -> rows.
// Every level is the same three numbers — Plan (budget), Left, Invested — summed over its rows, so the
// strip is always the sum of its sections and a section the sum of its rows.

/** One row of the Allocation list, whatever it is (a stock, PPF). Only what the screen reads. */
export interface AllocationLine {
  /** Unique within the list: the symbol. */
  key: string
  /** What the row is called. */
  name: string
  /** Where tapping the row goes. */
  href: string
  budget: number
  /** FY net spend, floored at 0 — the figure behind Left. */
  spent: number
  /** budget − spent. */
  remaining: number
  /** What is deployed this FY at cost — the figure behind Invested and the bar. */
  currentCost: number
}

export interface Totals {
  /** Sum of the rows' budgets (what the strip calls Plan). */
  budget: number
  /** Sum of `currentCost`. */
  invested: number
  /** budget − sum of `spent`; can be negative (the screen shows it floored at 0). */
  remaining: number
  /** invested / budget, in %, 0 with no budget. */
  pctInvested: number
  /** max(0, remaining) / budget, in %, 0 with no budget. Not 100 − pctInvested (see the Investment Math). */
  pctLeft: number
}

export interface AllocationSectionData extends Totals {
  sleeve: Sleeve
  lines: AllocationLine[]
}

export function totalsOf(lines: AllocationLine[]): Totals {
  const budget = lines.reduce((s, l) => s + l.budget, 0)
  const invested = lines.reduce((s, l) => s + l.currentCost, 0)
  const remaining = budget - lines.reduce((s, l) => s + l.spent, 0)
  return {
    budget,
    invested,
    remaining,
    pctInvested: budget > 0 ? (invested / budget) * 100 : 0,
    pctLeft: budget > 0 ? (Math.max(0, remaining) / budget) * 100 : 0,
  }
}

/** A stock row of the list, from the figures `computeStockRows` produced. */
export function stockLine(row: StockRow, fyLabel: string): AllocationLine {
  return {
    key: row.symbol,
    name: row.symbol,
    href: `/stocks/${row.symbol}?fy=${encodeURIComponent(fyLabel)}`,
    budget: row.budget,
    spent: row.spent,
    remaining: row.remaining,
    currentCost: row.currentCost,
  }
}

/**
 * The PPF row: its budget is its % of the Debt sleeve, and what is invested is the FY's deposits (there are
 * no sells, so what is spent and what is deployed at cost are the same). It opens Portfolio, where PPF lives.
 */
export function ppfLine(alloc: Pick<StockAllocation, 'allocation_pct'>, fy: Parameters<typeof sleeveBudget>[0], invested: number): AllocationLine {
  const budget = rowBudget(alloc.allocation_pct, sleeveBudget(fy, 'debt'))
  return {
    key: PPF_SYMBOL,
    name: 'PPF',
    href: '/portfolio',
    budget,
    spent: invested,
    remaining: budget - invested,
    currentCost: invested,
  }
}

/**
 * A debt / arbitrage fund row: its budget is its % of the Debt sleeve, invested is the FY's net MF buys (floored
 * at 0, see `fundInvestedByScheme`). It opens the fund's Portfolio page, or Portfolio itself while the fund has
 * no holding record yet (planned, nothing bought).
 */
export function fundLine(
  alloc: Pick<StockAllocation, 'symbol' | 'allocation_pct' | 'name'>,
  fy: Parameters<typeof sleeveBudget>[0],
  invested: number,
  fundId: string | null,
): AllocationLine {
  const budget = rowBudget(alloc.allocation_pct, sleeveBudget(fy, 'debt'))
  return {
    key: alloc.symbol,
    name: alloc.name ?? alloc.symbol,
    href: fundId ? `/portfolio/mf/${fundId}` : '/portfolio',
    budget,
    spent: invested,
    remaining: budget - invested,
    currentCost: invested,
  }
}

/**
 * A gold row (SGB or gold ETF): its budget is its % of the Gold sleeve, invested is the FY's net buys of that
 * instrument (floored at 0, see `goldInvestedByInstrument`). It opens Portfolio, where gold lives.
 */
export function goldLine(alloc: Pick<StockAllocation, 'symbol' | 'allocation_pct'>, fy: Parameters<typeof sleeveBudget>[0], invested: number): AllocationLine {
  const budget = rowBudget(alloc.allocation_pct, sleeveBudget(fy, 'gold'))
  return {
    key: alloc.symbol,
    name: alloc.symbol,
    href: '/portfolio',
    budget,
    spent: invested,
    remaining: budget - invested,
    currentCost: invested,
  }
}

/**
 * The sections of the list: one per sleeve that has rows (Equity, Debt, Gold order), each with its rows
 * by name. A sleeve with no rows has no section here — it is only a header on the Plan screen.
 */
export function allocationSections(equityLines: AllocationLine[], debtLines: AllocationLine[], goldLines: AllocationLine[] = []): AllocationSectionData[] {
  const bySleeve: Record<Sleeve, AllocationLine[]> = { equity: equityLines, debt: debtLines, gold: goldLines }
  return SLEEVES
    .filter(sleeve => bySleeve[sleeve].length > 0)
    .map(sleeve => {
      const lines = [...bySleeve[sleeve]].sort((a, b) => a.name.localeCompare(b.name))
      return { sleeve, lines, ...totalsOf(lines) }
    })
}

/** The strip's figures: the same three numbers over every row of every section. */
export function stripTotals(sections: AllocationSectionData[]): Totals {
  return totalsOf(sections.flatMap(s => s.lines))
}
