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
  cumulativePct: number   // s.211 cumulative %: 0.15/0.45/0.75/1.00
}

export const INTEREST_RATE_PER_MONTH = 0.01
export const SUPPRESS_BELOW          = 10_000

/** The 4 advance-tax due dates for a given FY. Jun/Sep/Dec fall in the FY's
 * start year; Mar falls in its end year (FY runs Apr-Mar). */
export function advanceTaxMilestones(fy: FiscalYear): AdvanceTaxMilestone[] {
  const startYear = new Date(fy.start_date).getFullYear()
  const endYear    = new Date(fy.end_date).getFullYear()
  return [
    { key: 'jun', label: '15 Jun', date: `${startYear}-06-15`, monthsIfShort: 3, cumulativePct: 0.15 },
    { key: 'sep', label: '15 Sep', date: `${startYear}-09-15`, monthsIfShort: 3, cumulativePct: 0.45 },
    { key: 'dec', label: '15 Dec', date: `${startYear}-12-15`, monthsIfShort: 3, cumulativePct: 0.75 },
    { key: 'mar', label: '15 Mar', date: `${endYear}-03-15`,   monthsIfShort: 1, cumulativePct: 1.00 },
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
 * that date, standing in for "estimated total tax" since Haku only tracks
 * capital gains + dividends (no salary/business income to forecast).
 *
 * Each instalment's target is the s.211 cumulative percentage (15/45/75/100%)
 * of that running estimate, recomputed fresh at each milestone from
 * gains-to-date — not 100% of it. An earlier version of this function used
 * 100% at every milestone, which is wrong: it demanded the full year's tax be
 * paid by the first quarter alone. The s.234C capital-gains carve-out means
 * you're not penalised for a shortfall caused by a gain that hadn't happened
 * yet by an earlier due date — it does not mean each checkpoint's target is
 * the full amount instead of its statutory share.
 *
 * `paid[key]` is what was actually logged against that specific quarter, not
 * a running year-to-date total the caller must maintain — a missed Jun
 * instalment paid off together with Sep just gets logged entirely under
 * `sep`. This function accumulates `paid` across milestones itself, in
 * milestone order, before comparing to each `target`, so it doesn't matter
 * which field a catch-up payment landed in. `InstalmentResult.paid` is this
 * running cumulative total through that milestone — what the UI displays.
 *
 * `shortfall`/`interest` are 0 for milestones whose due date hasn't passed
 * yet. Once a milestone is past, its `target` is derived from historical
 * transactions and can't change; only `paid` can be edited later (correcting
 * a missed log entry). Because accumulation only runs forward through
 * milestone order, a *later* milestone's own `paid` field never feeds back
 * into an *earlier* milestone's shortfall — editing `mar` can't retroactively
 * erase a shortfall already accrued at `jun`/`sep`/`dec`.
 */
export function computeInstalments(
  milestones:    AdvanceTaxMilestone[],
  liabilityAsOf: (date: string) => number,
  paid:          AdvanceTaxPaid,
  asOfToday:     string,
): InstalmentResult[] {
  let cumulativePaid = 0
  return milestones.map(milestone => {
    const isPast    = asOfToday >= milestone.date
    const target    = milestone.cumulativePct * liabilityAsOf(milestone.date)
    cumulativePaid += paid[milestone.key]
    const shortfall = isPast ? Math.max(0, target - cumulativePaid) : 0
    const interest  = isPast ? shortfall * INTEREST_RATE_PER_MONTH * milestone.monthsIfShort : 0
    return { milestone, isPast, target, paid: cumulativePaid, shortfall, interest }
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
