import type { RealisedGain } from './tax-compute'

// ── Bucketing ────────────────────────────────────────────────────────────────
// The 5 buckets a realised gain can land in. Stock + equity MF go to the
// equity buckets; debt MF + gold ETF (sold, not SGB/held-to-maturity — those
// are excluded upstream, before gains ever reach this module) share the debt
// buckets, since post-Budget-2024 they carry the same 12.5%/slab rate split.
// Dividends aren't a capital-gains bucket (can't absorb or be absorbed by a
// loss) so they're handled separately throughout.

export interface BucketTotals {
  equityLTCG: number
  equitySTCG: number
  debtLTCG:   number
  debtSTCG:   number
}

export type Bucket = keyof BucketTotals

const EPSILON = 1e-6

export const LTCG_EXEMPTION    = 125_000  // 1.25 L — Budget 2024, equity LTCG only
export const RATE_EQUITY_LTCG  = 0.125
export const RATE_EQUITY_STCG  = 0.20
export const RATE_DEBT_LTCG    = 0.125
export const CESS_RATE         = 0.04
export const DIVIDEND_TDS_RATE = 0.10

/** Sums already-classified realised gains into the 4 buckets. `equity` is
 * stock + equity-MF realised gains; `debt` is debt-MF + gold-ETF realised
 * gains — the caller has already picked the right pool per source. */
export function bucketGains(equity: RealisedGain[], debt: RealisedGain[]): BucketTotals {
  const totals: BucketTotals = { equityLTCG: 0, equitySTCG: 0, debtLTCG: 0, debtSTCG: 0 }
  for (const g of equity) { if (g.gainType === 'LTCG') totals.equityLTCG += g.gain; else totals.equitySTCG += g.gain }
  for (const g of debt)   { if (g.gainType === 'LTCG') totals.debtLTCG   += g.gain; else totals.debtSTCG   += g.gain }
  return totals
}

function bucketRate(bucket: Bucket, slabRatePct: number): number {
  if (bucket === 'equitySTCG') return RATE_EQUITY_STCG
  if (bucket === 'debtSTCG')   return slabRatePct / 100
  return RATE_EQUITY_LTCG  // equityLTCG, debtLTCG
}

// Highest-rate-first; on a tie, debt LTCG before equity LTCG (spec-mandated
// tiebreak for the 12.5% tier — the only tie that can occur at fixed rates,
// though a slab rate equal to 20% could also tie equitySTCG/debtSTCG, broken
// by declaration order below since the spec doesn't address that case).
function sortTargets(candidates: Bucket[], values: BucketTotals, slabRatePct: number): Bucket[] {
  return candidates
    .filter(b => values[b] > EPSILON)
    .sort((a, b) => {
      const diff = bucketRate(b, slabRatePct) - bucketRate(a, slabRatePct)
      if (Math.abs(diff) > 1e-9) return diff
      if (a === 'debtLTCG' && b === 'equityLTCG') return -1
      if (b === 'debtLTCG' && a === 'equityLTCG') return 1
      return 0
    })
}

/** Drains `pool` into `targets` in order, mutating `values` and appending a
 * move per bucket touched. Returns the amount actually absorbed (<= pool). */
function absorb(
  pool:   number,
  from:   SetOffMove['from'],
  targets: Bucket[],
  values: BucketTotals,
  moves:  SetOffMove[],
): number {
  let remaining = pool
  for (const to of targets) {
    if (remaining <= EPSILON) break
    const take = Math.min(remaining, values[to])
    if (take <= EPSILON) continue
    values[to] -= take
    remaining  -= take
    moves.push({ from, to, amount: take })
  }
  return pool - remaining
}

export interface SetOffMove {
  from:   Bucket | 'carryForwardShort' | 'carryForwardLong'
  to:     Bucket
  amount: number
}

export interface CarryForwardAmounts {
  shortTerm: number
  longTerm:  number
}

export interface SetOffResult {
  /** Post-exemption, post-setoff bucket values. Buckets that were themselves
   * a loss source are untouched (stay at their raw negative total) — set-off
   * never reduces a bucket below what it already contributed as a source. */
  final:            BucketTotals
  exemptionApplied: number
  moves:            SetOffMove[]
  /** This FY's own fresh unabsorbed loss — write as a new carryforward ledger row. */
  newCarryForward:  CarryForwardAmounts
  /** Portion of `incomingCarryForward` actually consumed — decrement the ledger by this. */
  carryForwardUsed: CarryForwardAmounts
}

const LT_TARGETS: Bucket[] = ['debtLTCG', 'equityLTCG']
const ST_TARGETS: Bucket[] = ['equitySTCG', 'debtSTCG', 'debtLTCG', 'equityLTCG']

/**
 * Exemption first, then intra-year set-off (this FY's own losses, long-term
 * pool before short-term since LT losses have fewer eligible homes), then
 * incoming carryforward mops up whatever room is left (same LT-before-ST
 * order). A short-term loss can hit any positive bucket; a long-term loss
 * only the two LT buckets. Dividends never participate.
 */
export function applySetOff(
  raw:                  BucketTotals,
  incomingCarryForward: CarryForwardAmounts,
  slabRatePct:          number,
): SetOffResult {
  const values: BucketTotals = { ...raw }
  const moves:  SetOffMove[] = []

  let exemptionApplied = 0
  if (values.equityLTCG > 0) {
    exemptionApplied = Math.min(values.equityLTCG, LTCG_EXEMPTION)
    values.equityLTCG -= exemptionApplied
  }

  const ownLTLoss =
    (values.equityLTCG < -EPSILON ? -values.equityLTCG : 0) +
    (values.debtLTCG   < -EPSILON ? -values.debtLTCG   : 0)
  const ownSTLoss =
    (values.equitySTCG < -EPSILON ? -values.equitySTCG : 0) +
    (values.debtSTCG   < -EPSILON ? -values.debtSTCG   : 0)

  function runPass(sources: Bucket[], targetsBase: Bucket[], from: (src: Bucket) => SetOffMove['from']): number {
    let absorbed = 0
    for (const src of sources) {
      const pool = values[src] < -EPSILON ? -values[src] : 0
      if (pool <= EPSILON) continue
      const targets = sortTargets(targetsBase.filter(t => t !== src), values, slabRatePct)
      absorbed += absorb(pool, from(src), targets, values, moves)
    }
    return absorbed
  }

  const ownLTAbsorbed = runPass((['debtLTCG', 'equityLTCG'] as Bucket[]), LT_TARGETS, src => src)
  const ownSTAbsorbed = runPass((['equitySTCG', 'debtSTCG'] as Bucket[]), ST_TARGETS, src => src)

  const newCarryForward: CarryForwardAmounts = {
    longTerm:  Math.max(0, ownLTLoss - ownLTAbsorbed),
    shortTerm: Math.max(0, ownSTLoss - ownSTAbsorbed),
  }

  const carryForwardUsed: CarryForwardAmounts = {
    longTerm:  absorb(incomingCarryForward.longTerm,  'carryForwardLong',  sortTargets(LT_TARGETS, values, slabRatePct), values, moves),
    shortTerm: absorb(incomingCarryForward.shortTerm, 'carryForwardShort', sortTargets(ST_TARGETS, values, slabRatePct), values, moves),
  }

  return { final: values, exemptionApplied, moves, newCarryForward, carryForwardUsed }
}

// ── Tax ──────────────────────────────────────────────────────────────────────

export interface TaxLine {
  bucket:  Bucket | 'dividends'
  rate:    number
  taxable: number
  tax:     number
}

export interface TaxResult {
  lines: TaxLine[]
  tax:   number
  cess:  number
  total: number  // tax + cess, before TDS/advance-tax credits
}

const CAPITAL_GAIN_BUCKETS: Bucket[] = ['equityLTCG', 'equitySTCG', 'debtLTCG', 'debtSTCG']

/** Per-bucket taxable × rate, summed, plus 4% cess. A bucket that's still net
 * negative after set-off (a loss with nowhere left to go) contributes no tax
 * line — it isn't "taxable at 0", it's simply not a gain. */
export function computeTax(final: BucketTotals, dividendIncome: number, slabRatePct: number): TaxResult {
  const lines: TaxLine[] = []
  for (const bucket of CAPITAL_GAIN_BUCKETS) {
    const taxable = final[bucket]
    if (taxable < -EPSILON) continue
    const rate = bucketRate(bucket, slabRatePct)
    lines.push({ bucket, rate, taxable, tax: taxable * rate })
  }

  const dividendRate = slabRatePct / 100
  lines.push({ bucket: 'dividends', rate: dividendRate, taxable: dividendIncome, tax: dividendIncome * dividendRate })

  const tax  = lines.reduce((s, l) => s + l.tax, 0)
  const cess = tax * CESS_RATE
  return { lines, tax, cess, total: tax + cess }
}

/** Flat 10% TDS under s.194, credited against the final balance — not a rate
 * the user controls, distinct from the slab-rate tax actually owed on the
 * dividend bucket in computeTax(). */
export function dividendTDS(dividendIncome: number): number {
  return dividendIncome * DIVIDEND_TDS_RATE
}
