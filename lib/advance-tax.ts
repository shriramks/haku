import type { FiscalYear, Transaction, DividendTransaction } from './types'
import type { MFund, MFTransaction, SGBTransaction } from './portfolio-types'
import { gatherBucketedGains } from './tax-compute'
import { bucketGains, applySetOff, computeTax, dividendTDS } from './tax-liability'
import type { CarryForwardAmounts } from './tax-liability'

export type MilestoneKey = 'jun' | 'sep' | 'dec' | 'mar'

export interface AdvanceTaxMilestone {
  key:           MilestoneKey
  label:         string   // '15 Jun'
  date:          string   // 'YYYY-MM-DD'
  monthsIfShort: number   // s.234C multiplier: 3 for Jun/Sep/Dec, 1 for Mar
}

export const INTEREST_RATE_PER_MONTH = 0.01
export const SUPPRESS_BELOW          = 10_000

/** The 4 advance-tax due dates for a given FY. Jun/Sep/Dec fall in the FY's
 * start year; Mar falls in its end year (FY runs Apr-Mar). */
export function advanceTaxMilestones(fy: FiscalYear): AdvanceTaxMilestone[] {
  const startYear = new Date(fy.start_date).getFullYear()
  const endYear    = new Date(fy.end_date).getFullYear()
  return [
    { key: 'jun', label: '15 Jun', date: `${startYear}-06-15`, monthsIfShort: 3 },
    { key: 'sep', label: '15 Sep', date: `${startYear}-09-15`, monthsIfShort: 3 },
    { key: 'dec', label: '15 Dec', date: `${startYear}-12-15`, monthsIfShort: 3 },
    { key: 'mar', label: '15 Mar', date: `${endYear}-03-15`,   monthsIfShort: 1 },
  ]
}

export type AdvanceTaxPaid = Record<MilestoneKey, number>

export interface InstalmentResult {
  milestone: AdvanceTaxMilestone
  isPast:    boolean
  target:    number
  paid:      number
  shortfall: number
  interest:  number
}

/**
 * `liabilityAsOf(date)` must return the net tax liability (post cess, post
 * dividend-TDS credit) on everything realised from FY start through `date`
 * — the caller re-runs the #77 bucketing/set-off/tax pipeline truncated to
 * that date. Each instalment's target is 100% of that figure, not a
 * percentage of an annual estimate: capital gains carry a s.234C carve-out
 * where tax is only owed once a gain actually happens, so there's nothing to
 * forecast against.
 *
 * `shortfall`/`interest` are 0 for milestones whose due date hasn't passed
 * yet. Once a milestone is past, its `target` is derived from historical
 * transactions and can't change; only `paid` can be edited later (correcting
 * a missed log entry), which recomputes that milestone's own shortfall and
 * interest without touching any other milestone — a later quarter's payment
 * never retroactively absorbs an earlier quarter's shortfall.
 */
export function computeInstalments(
  milestones:    AdvanceTaxMilestone[],
  liabilityAsOf: (date: string) => number,
  paid:          AdvanceTaxPaid,
  asOfToday:     string,
): InstalmentResult[] {
  return milestones.map(milestone => {
    const isPast     = asOfToday >= milestone.date
    const target     = liabilityAsOf(milestone.date)
    const paidAmount = paid[milestone.key]
    const shortfall  = isPast ? Math.max(0, target - paidAmount) : 0
    const interest   = isPast ? shortfall * INTEREST_RATE_PER_MONTH * milestone.monthsIfShort : 0
    return { milestone, isPast, target, paid: paidAmount, shortfall, interest }
  })
}

/** Advance tax reminders are noise below the s.208 threshold. */
export function shouldSuppressInstalments(projectedAnnualLiability: number): boolean {
  return projectedAnnualLiability < SUPPRESS_BELOW
}

export interface LiabilityAsOfInputs {
  stockMap:             Map<string, Transaction[]>
  mfMap:                Map<string, MFTransaction[]>
  mfFunds:              MFund[]
  goldMap:              Map<string, SGBTransaction[]>   // keyed by gold_type: 'sgb' | 'etf' | 'physical'
  dividends:            DividendTransaction[]
  fyStart:              string
  incomingCarryForward: CarryForwardAmounts
  slabRatePct:          number
}

/**
 * Builds the `liabilityAsOf` callback `computeInstalments()` needs — reruns
 * the #77 gains/bucket/set-off/tax pipeline truncated to a given date. FIFO
 * lot state is rebuilt fresh per call from the full transaction history, so
 * truncating the range is safe: `fifoConsume` still advances through sells
 * after the cutoff, it just omits them from the returned realised gains.
 *
 * Gold/bucket-gathering logic lives in `gatherBucketedGains()` (tax-compute.ts)
 * — shared with the tax page and carryforward reconciliation. Only 'etf' lots
 * are taxed, folded into the debt bucket; 'sgb' and 'physical' are excluded
 * entirely (#79.b: no resolved rate for gold's own LTCG threshold within the
 * equity/debt-only bucket model).
 */
export function buildLiabilityAsOf(inputs: LiabilityAsOfInputs): (date: string) => number {
  const { stockMap, mfMap, mfFunds, goldMap, dividends, fyStart, incomingCarryForward, slabRatePct } = inputs

  return function liabilityAsOf(date: string): number {
    const range = { start: fyStart, end: date }
    const { equity, debt } = gatherBucketedGains({ stockMap, mfMap, mfFunds, goldMap, fyRange: range, asOf: date })

    const dividendIncome = dividends
      .filter(d => d.ex_date >= range.start && d.ex_date <= range.end)
      .reduce((s, d) => s + d.amount, 0)

    const { final }  = applySetOff(bucketGains(equity, debt), incomingCarryForward, slabRatePct)
    const taxResult   = computeTax(final, dividendIncome, slabRatePct)
    return taxResult.total - dividendTDS(dividendIncome)
  }
}
