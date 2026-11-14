import type { AllocationKind, FiscalYear } from './types'
import type { PPFTransaction } from './portfolio-types'

// Plan sleeves (#180): an FY's pool is split into Equity / Debt / Gold by %, and each plan row
// takes a % of its own sleeve. Every budget figure in the app comes from the functions here, so the
// formula lives in one place (Allocation, Bands, Stock Detail, tranches, Plan).

export type Sleeve = 'equity' | 'debt' | 'gold'
export const SLEEVES: readonly Sleeve[] = ['equity', 'debt', 'gold']
export const SLEEVE_LABEL: Record<Sleeve, string> = { equity: 'Equity', debt: 'Debt', gold: 'Gold' }

type PoolFields = Pick<FiscalYear, 'total_budget_inr' | 'unallocated_carryover_inr'>
type SleeveFields = Pick<FiscalYear, 'equity_pct' | 'debt_pct' | 'gold_pct'>

/** The FY pool: its budget plus carryover. */
export function fyPool(fy: PoolFields | null | undefined): number {
  return (fy?.total_budget_inr ?? 0) + (fy?.unallocated_carryover_inr ?? 0)
}

const SLEEVE_FIELD: Record<Sleeve, keyof SleeveFields> = { equity: 'equity_pct', debt: 'debt_pct', gold: 'gold_pct' }

/**
 * A sleeve's % of the pool. A missing value (an FY row cached before the columns existed, or no FY at
 * all) is the default: Equity 100, everything else 0 — so such an FY behaves exactly as before sleeves.
 */
export function sleevePct(fy: Partial<SleeveFields> | null | undefined, sleeve: Sleeve): number {
  const v = Number(fy?.[SLEEVE_FIELD[sleeve]])
  if (Number.isFinite(v)) return v
  return sleeve === 'equity' ? 100 : 0
}

/** A sleeve's amount: its % of the pool. */
export function sleeveBudget(fy: (PoolFields & Partial<SleeveFields>) | null | undefined, sleeve: Sleeve): number {
  return (sleevePct(fy, sleeve) / 100) * fyPool(fy)
}

/** A row's budget: its % of the sleeve amount it sits in. */
export function rowBudget(allocationPct: number, sleeveAmount: number): number {
  return (allocationPct / 100) * sleeveAmount
}

/** Which sleeve a plan row belongs to. */
export function allocSleeve(kind: AllocationKind): Sleeve {
  return kind === 'stock' ? 'equity' : 'debt'
}

/** Only the stock rows — Bands, price refresh, tranches and Stock Detail are stock features. */
export function stockAllocations<T extends { kind: AllocationKind }>(allocs: T[]): T[] {
  return allocs.filter(a => a.kind === 'stock')
}

/** PPF money put in during [start, end] (inclusive ISO dates). Interest and withdrawals are not invested money. */
export function ppfDeposited(
  txns: Pick<PPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  start: string,
  end: string,
): number {
  return txns
    .filter(t => t.trade_type === 'deposit' && t.trade_date >= start && t.trade_date <= end)
    .reduce((s, t) => s + t.amount, 0)
}

/** A closed FY's carryover: its pool minus everything deployed — net stock spend and PPF deposits. Negative when over-invested. */
export function fyCarryover(pool: number, stockNetDeployed: number, ppfDeposits: number): number {
  return pool - stockNetDeployed - ppfDeposits
}
