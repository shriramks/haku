// AI Investment Playbook v11 — band computation.
// Part B: DDM-factor PE bands for individual stocks.
// Part C: Index ETF PE bands — factor always 1, different PE thresholds.

import type { StockCategory } from './types'
import type { Zone, Signal } from './snowball'

// ── Category registry ────────────────────────────────────────────────────────
// One definition per category. A new StockCategory is a compile error until it has a spec.

interface Mult { buyLow: number; buyHigh: number; midLow: number; midHigh: number; trim: number }

interface IndexSpec {
  kind: 'index'
  multiples: Mult
  /** Where the index PE comes from: an NSE index (level + PE) or multpl.com (S&P 500, PE only). */
  indexSource: { feed: 'nse'; name: string } | { feed: 'multpl' }
  /** Cap on generated buy levels, for a sleeve that is added to slowly. */
  maxTranches?: number
}

interface StockSpec {
  kind: 'stock'
  multiples: Mult
  midpointPE: number
  roceThreshold: number
  /** Hospitals: floor g when PAT CAGR is low but ROCE is high (expansion phase). */
  growthFloor?: boolean
  /** Stop and ask for an EV/EBITDA override when CMP / EPS exceeds this. */
  peGuardMax?: number
}

export type CategorySpec = IndexSpec | StockSpec

export const CATEGORY_SPEC: Record<StockCategory, CategorySpec> = {
  // Index ETFs (v11; Next 50 recalibrated Oct 2026): eps = cmp / indexPE  (rupee value of 1 PE point, live)
  'Nifty 50 Index':      { kind: 'index', indexSource: { feed: 'nse', name: 'NIFTY 50' },
    multiples: { buyLow: 18, buyHigh: 20, midLow: 20, midHigh: 22, trim: 24 } },
  'Nifty Next 50 Index': { kind: 'index', indexSource: { feed: 'nse', name: 'NIFTY NEXT 50' },
    multiples: { buyLow: 17, buyHigh: 20, midLow: 20, midHigh: 23, trim: 26 } },
  // S&P 500 (VUAA): eps = cmp / multpl PE, in the ETF's own currency. A slow-add sleeve: 3 buy levels at most.
  'S&P 500 Index':       { kind: 'index', indexSource: { feed: 'multpl' }, maxTranches: 3,
    multiples: { buyLow: 22, buyHigh: 25, midLow: 25, midHigh: 28, trim: 31 } },
  'Cap-Light Infra': { kind: 'stock', midpointPE: 31.5, roceThreshold: 22,
    multiples: { buyLow: 28, buyHigh: 35, midLow: 36, midHigh: 44, trim: 45 } },
  'Hospitals':       { kind: 'stock', midpointPE: 41.5, roceThreshold: 16, growthFloor: true, peGuardMax: 80,
    multiples: { buyLow: 38, buyHigh: 45, midLow: 46, midHigh: 55, trim: 56 } },
  'Branded Pharma':  { kind: 'stock', midpointPE: 23.0, roceThreshold: 18,
    multiples: { buyLow: 20, buyHigh: 26, midLow: 27, midHigh: 32, trim: 33 } },
  'Tobacco Corp':    { kind: 'stock', midpointPE: 22.5, roceThreshold: 20,
    multiples: { buyLow: 20, buyHigh: 25, midLow: 26, midHigh: 30, trim: 31 } },
  'Niche Cap Goods': { kind: 'stock', midpointPE: 27.0, roceThreshold: 20,
    multiples: { buyLow: 24, buyHigh: 30, midLow: 31, midHigh: 38, trim: 39 } },
  'Jewellery':       { kind: 'stock', midpointPE: 28.0, roceThreshold: 18,
    multiples: { buyLow: 24, buyHigh: 32, midLow: 33, midHigh: 42, trim: 43 } },
}

function specOf(category: string | null | undefined): CategorySpec | null {
  return category && category in CATEGORY_SPEC ? CATEGORY_SPEC[category as StockCategory] : null
}

export function isIndexCategory(category: string | null | undefined): boolean {
  return specOf(category)?.kind === 'index'
}

/** NSE index name for an NSE-fed index category, else null. */
export function getIndexSource(category: string | null | undefined): string | null {
  const spec = specOf(category)
  return spec?.kind === 'index' && spec.indexSource.feed === 'nse' ? spec.indexSource.name : null
}

/** Which feed supplies an index category's PE, else null. */
export function getIndexFeed(category: string | null | undefined): 'nse' | 'multpl' | null {
  const spec = specOf(category)
  return spec?.kind === 'index' ? spec.indexSource.feed : null
}

/** Maximum number of buy levels for a category, or null when uncapped. */
export function getTrancheCap(category: string | null | undefined): number | null {
  const spec = specOf(category)
  return spec?.kind === 'index' ? (spec.maxTranches ?? null) : null
}

export function hasGrowthFloor(category: string | null | undefined): boolean {
  const spec = specOf(category)
  return spec?.kind === 'stock' && !!spec.growthFloor
}

/** Max CMP / EPS before the band computation stops, or null when the category has no guard. */
export function getPeGuardMax(category: string | null | undefined): number | null {
  const spec = specOf(category)
  return spec?.kind === 'stock' ? spec.peGuardMax ?? null : null
}

/** Growth for a category: applies the category's growth floor if it has one. */
export function computeCategoryGrowth(
  category: string | null | undefined,
  patNow: number | null,
  pat3yrAgo: number | null,
  roce3yrAvg: number | null,
): { g: number | null; growthSource: 'hospital_expansion_phase_floor' | 'calculated_3y_pat_cagr' } {
  return hasGrowthFloor(category)
    ? computeHospitalGrowth(patNow, pat3yrAgo, roce3yrAvg)
    : { g: computeGrowth(patNow, pat3yrAgo), growthSource: 'calculated_3y_pat_cagr' }
}

export const DEFAULT_ERP = 0.05

export function getSizeMod(mcap: number): number {
  if (mcap < 50_000)  return 1.00
  if (mcap < 100_000) return 0.97
  if (mcap < 200_000) return 0.94
  return 0.90
}

export function getSizeModValueLabel(mcap: number | null): string {
  return mcap == null ? '1.00' : getSizeMod(mcap).toFixed(2)
}

export function getSizeModRangeLabel(mcap: number | null): string {
  if (mcap == null) return '—'
  const sizeMod = getSizeMod(mcap)
  if (sizeMod === 1.00) return '1.00 (< 50k Cr)'
  if (sizeMod === 0.97) return '0.97 (< 1L Cr)'
  if (sizeMod === 0.94) return '0.94 (< 2L Cr)'
  return '0.90 (>= 2L Cr)'
}

export function getRoceThreshold(category: StockCategory): number | null {
  const spec = CATEGORY_SPEC[category]
  return spec.kind === 'stock' ? spec.roceThreshold : null
}

export function computeGrowth(patNow: number | null, pat3yrAgo: number | null): number | null {
  return (patNow && pat3yrAgo && pat3yrAgo > 0)
    ? Math.pow(patNow / pat3yrAgo, 1 / 3) - 1
    : null
}

// Hospitals only: if PAT CAGR < 10% but ROCE >= 16%, assume expansion phase and floor g at 15%.
export function computeHospitalGrowth(
  patNow: number | null,
  pat3yrAgo: number | null,
  roce3yrAvg: number | null,
): { g: number | null; growthSource: 'hospital_expansion_phase_floor' | 'calculated_3y_pat_cagr' } {
  const g = computeGrowth(patNow, pat3yrAgo)
  if (g !== null && g < 0.10 && roce3yrAvg !== null && roce3yrAvg >= 16) {
    return { g: 0.15, growthSource: 'hospital_expansion_phase_floor' }
  }
  return { g, growthSource: 'calculated_3y_pat_cagr' }
}

// CMP/PE method: cmp ÷ PE is the rupee value of one PE point — i.e. earnings per
// ETF unit, read off the live price. Divisor-proof: no index_level/100 guess, so
// dividend drift / reconstitution / splits self-correct each session via live CMP.
export function deriveIndexEps(cmp: number | null, indexPE: number | null): number | null {
  return (cmp != null && indexPE != null && indexPE > 0)
    ? cmp / indexPE
    : null
}

export interface FinancialInputs {
  patNow: number | null
  pat3yrAgo: number | null
  roce3yrAvg: number | null
  opProfitCr: number | null
  revenueCr: number | null
}

export interface SnapshotFields {
  pat_now: number
  pat_3yr_ago: number
  op_profit_cr: number | null
  revenue_cr: number | null
  g_computed: number | null
  op_margin: number | null
}

/**
 * Single derivation of everything computed from a stock's stored financials: growth (with the
 * category floor), operating margin, and the quarterly snapshot row. The route and the Financials
 * save both go through this so they cannot disagree. `snapshot` is null until both PAT figures exist.
 */
export function deriveBandInputs(
  category: string | null | undefined,
  f: FinancialInputs,
): { g: number | null; growthSource: 'hospital_expansion_phase_floor' | 'calculated_3y_pat_cagr'; opMargin: number | null; snapshot: SnapshotFields | null } {
  const { g, growthSource } = computeCategoryGrowth(category, f.patNow, f.pat3yrAgo, f.roce3yrAvg)
  const opMargin = (f.opProfitCr != null && f.revenueCr != null && f.revenueCr !== 0)
    ? f.opProfitCr / f.revenueCr
    : null
  const snapshot = (f.patNow != null && f.pat3yrAgo != null)
    ? { pat_now: f.patNow, pat_3yr_ago: f.pat3yrAgo, op_profit_cr: f.opProfitCr, revenue_cr: f.revenueCr, g_computed: g, op_margin: opMargin }
    : null
  return { g, growthSource, opMargin, snapshot }
}

/** Why bands cannot be computed from the stored inputs, or null when they can. */
export function checkBandReadiness(
  symbol: string,
  category: string,
  s: { eps: number | null; patNow: number | null; pat3yrAgo: number | null; roce3yrAvg: number | null; mcap: number | null; cmp: number | null },
): string | null {
  const isIndex = isIndexCategory(category)
  if (!s.eps || (!isIndex && (s.patNow == null || s.pat3yrAgo == null || s.roce3yrAvg == null || s.mcap == null))) {
    return isIndex
      ? `Missing CMP/PE for ${symbol}. Run Regen Bands to fetch fresh index data.`
      : `No saved financials for ${symbol}. Use Regen Financials first.`
  }
  const peGuardMax = getPeGuardMax(category)
  if (peGuardMax != null && s.cmp && s.cmp / s.eps > peGuardMax) {
    return `PE unreliable (${Math.round(s.cmp / s.eps)}×) — EV/EBITDA override needed for ${symbol}`
  }
  return null
}

export function getCostOfEquity(riskFree: number): number {
  return riskFree + DEFAULT_ERP
}

export function isBandStale(
  generatedAt: string | null | undefined,
  lastUpdatedAt: string | null | undefined,
): boolean {
  return !!(generatedAt && lastUpdatedAt && lastUpdatedAt > generatedAt)
}

// ── Risk overlay ──────────────────────────────────────────────────────────────

/**
 * Single source of truth for the risk overlay.
 *
 * The stored band row holds the *raw* PE-derived prices. A risk overlay scales
 * every band price by `risk_multiplier` (e.g. 0.9 = 10% more conservative). This
 * helper applies that one rule so buy-band display, snowball/conviction, and
 * tranche pricing all consume identical effective bands — never duplicate the
 * multiplication at a call site.
 *
 * Raw values are kept in the DB; the overlay is applied at compute time only, so
 * changing or clearing it instantly reflows everything with no derived data lost.
 *
 * `risk_multiplier` of null or 1 means no overlay → raw values pass through and
 * `hasOverlay` is false. Mid bands fall back to buy_high when absent (legacy rows).
 */
export interface EffectiveBands {
  buyLow: number | null
  buyHigh: number | null
  midLow: number | null
  midHigh: number | null
  trimPrice: number | null
  riskMultiplier: number | null   // normalized: null when no overlay
  hasOverlay: boolean
}

export function effectiveBands(band: {
  buy_low: number | null
  buy_high: number | null
  mid_low?: number | null
  mid_high?: number | null
  trim_price?: number | null
  risk_multiplier?: number | null
} | null): EffectiveBands {
  const buyLow    = band?.buy_low ?? null
  const buyHigh   = band?.buy_high ?? null
  const midLow    = band?.mid_low ?? band?.buy_high ?? null
  const midHigh   = band?.mid_high ?? band?.buy_high ?? null
  const trimPrice = band?.trim_price ?? null

  const m = band?.risk_multiplier ?? null
  const hasOverlay = m != null && m !== 1
  const scale = (v: number | null) => (hasOverlay && v != null ? v * m! : v)

  return {
    buyLow:    scale(buyLow),
    buyHigh:   scale(buyHigh),
    midLow:    scale(midLow),
    midHigh:   scale(midHigh),
    trimPrice: scale(trimPrice),
    riskMultiplier: hasOverlay ? m : null,
    hasOverlay,
  }
}

// ── Conviction matrix ─────────────────────────────────────────────────────────

export type WeightMode = 'equal' | 'quadratic' | 'cubic'

export interface ConvictionParams {
  trancheCount: number     // 0 = blocked (mid/watch/trim zone)
  weightMode: WeightMode
  deepExtension: number    // fraction below CMP to spread in deep zone (e.g. 0.10 = 10%)
  ceilingOverride: number | null  // absolute price ceiling; null = use default logic
}

const BLOCKED: ConvictionParams = { trancheCount: 0, weightMode: 'equal', deepExtension: 0.05, ceilingOverride: null }

/**
 * Returns tranche generation parameters for a (zone, signal) pair.
 * buyLow/buyHigh are needed to compute the lower-half ceiling for WAIT in buy zone.
 * INSUFFICIENT_DATA is treated conservatively as WAIT.
 */
export function convictionMatrix(zone: Zone, signal: Signal, buyLow: number, buyHigh: number): ConvictionParams {
  if (zone === 'MID' || zone === 'WATCH' || zone === 'TRIM') return BLOCKED

  const sig = signal === 'INSUFFICIENT_DATA' ? 'WAIT' : signal

  if (zone === 'DEEP_VALUE') {
    if (sig === 'ADD_AGGRESSIVELY') return { trancheCount: 7, weightMode: 'cubic',     deepExtension: 0.10, ceilingOverride: null }
    if (sig === 'ADD_SLOWLY')       return { trancheCount: 4, weightMode: 'quadratic', deepExtension: 0.07, ceilingOverride: null }
    return                                 { trancheCount: 3, weightMode: 'equal',     deepExtension: 0.05, ceilingOverride: null }
  }

  // BUY zone
  if (sig === 'ADD_AGGRESSIVELY') return { trancheCount: 5, weightMode: 'cubic',     deepExtension: 0.05, ceilingOverride: null }
  if (sig === 'ADD_SLOWLY')       return { trancheCount: 4, weightMode: 'quadratic', deepExtension: 0.05, ceilingOverride: null }
  // WAIT in buy zone: compress to lower half of the zone
  return { trancheCount: 2, weightMode: 'equal', deepExtension: 0.05, ceilingOverride: buyLow + (buyHigh - buyLow) * 0.5 }
}

// ── Tranche price constants ───────────────────────────────────────────────────

const SNAP_THRESHOLD  = 500   // ₹500: below this snap to ₹5, at/above snap to ₹10
const SNAP_SMALL      = 5
const SNAP_LARGE      = 10
const MIN_GAP_RATIO   = 0.03  // Minimum %-gap between adjacent tranches
const WEIGHT_CAP      = 0.40  // If largest quadratic weight > 40%, fall back to linear

const SNAP_SMALL_FOREIGN = 0.5
const SNAP_LARGE_FOREIGN = 1

/** Snap unit for a price. INR: < ₹500 → ₹5, ≥ ₹500 → ₹10. Any other currency: < 500 → 0.5, ≥ 500 → 1. */
export function snapUnit(price: number, currency = 'INR'): number {
  const foreign = currency !== 'INR'
  if (price < SNAP_THRESHOLD) return foreign ? SNAP_SMALL_FOREIGN : SNAP_SMALL
  return foreign ? SNAP_LARGE_FOREIGN : SNAP_LARGE
}

/** Round a price to its snap unit */
export function snapPrice(price: number, currency = 'INR'): number {
  const unit = snapUnit(price, currency)
  return Math.round(price / unit) * unit
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface BandInput {
  category: StockCategory
  eps?: number | null
  // Stock-only inputs — ignored for index categories
  g?: number | null           // PAT 3yr CAGR: (patNow / pat3yrAgo)^(1/3) - 1
  ke?: number | null          // Cost of equity: risk_free + 0.05
  mcap?: number | null        // Market cap in Cr
  roce3yrAvg?: number | null  // 3yr avg ROCE %
}

export interface BandResult {
  anchorUsed: string
  buyLow: number
  buyHigh: number
  midLow: number
  midHigh: number
  trimPrice: number
  factorBase: number
  factor: number
  path: 'A' | 'B' | 'index'
  rocePremium: boolean
}

export function calculateBands(input: BandInput): BandResult | null {
  const eps = input.eps
  if (!eps || eps <= 0) return null

  const spec = CATEGORY_SPEC[input.category]
  if (!spec) return null
  const base = spec.multiples

  if (spec.kind === 'index') {
    return {
      anchorUsed: 'PE',
      buyLow:    base.buyLow  * eps,
      buyHigh:   base.buyHigh * eps,
      midLow:    base.midLow  * eps,
      midHigh:   base.midHigh * eps,
      trimPrice: base.trim    * eps,
      factorBase: 1,
      factor: 1,
      path: 'index',
      rocePremium: false,
    }
  }

  // Part B: DDM factor for stocks
  const { g = null, ke = null, mcap = null, roce3yrAvg = null } = input
  const midpointPE = spec.midpointPE

  let factorBase: number
  let path: 'A' | 'B'

  if (
    ke !== null && g !== null && isFinite(g) &&
    ke > g && (ke - g) >= 0.02 && midpointPE !== null
  ) {
    // Path A: Damodaran stable-growth DDM
    const peIntrinsic = (1 + g) / (ke - g)
    factorBase = Math.max(0.60, Math.min(1.00, peIntrinsic / midpointPE))
    path = 'A'
  } else {
    // Path B: empirical — high compounder or near-singularity
    factorBase = mcap !== null ? getSizeMod(mcap) : 1.00
    path = 'B'
  }

  // ROCE premium (both paths)
  const roceThreshold = getRoceThreshold(input.category)
  let factor = factorBase
  let rocePremium = false
  if (roce3yrAvg !== null && roceThreshold !== null && roce3yrAvg > 2 * roceThreshold) {
    factor = Math.min(factor * 1.15, 1.15)
    rocePremium = true
  } else {
    factor = Math.min(factor, 1.00)
  }

  return {
    anchorUsed: 'PE',
    buyLow:    base.buyLow  * factor * eps,
    buyHigh:   base.buyHigh * factor * eps,
    midLow:    base.midLow  * factor * eps,
    midHigh:   base.midHigh * factor * eps,
    trimPrice: base.trim    * factor * eps,
    factorBase,
    factor,
    path,
    rocePremium,
  }
}

/**
 * Staged-buy price cap for deep value zone.
 *
 * When CMP is below buyLow (deep value) AND the user has prior buys at a higher
 * price, cap the effective CMP at (minBuyPrice − 1 snap unit) so every generated
 * tranche is strictly cheaper than their cheapest prior entry.
 *
 * Outside deep value (CMP ≥ buyLow) or when there are no prior buys, returns
 * liveCmp unchanged so normal zone logic applies.
 */
export function stagedDeepCmp(
  liveCmp: number | null,
  buyLow: number,
  minBuyPrice: number | null,
  currency = 'INR',
): number | null {
  const isDeep = liveCmp !== null && liveCmp < buyLow
  if (!isDeep || minBuyPrice === null) return liveCmp
  return Math.min(liveCmp, minBuyPrice - snapUnit(minBuyPrice, currency))
}

/** Tranche suggestion: 1–2% of total capital, capped at remaining */
export function trancheSuggestion(remainingBudget: number, totalCapital: number): number {
  const onePct = totalCapital * 0.01
  const twoPct = totalCapital * 0.02
  return Math.min(twoPct, Math.max(onePct, remainingBudget * 0.33))
}

/**
 * Tranche amounts split.
 *
 * 'equal': uniform split — used when zone certainty is low (above zone, deep WAIT).
 * 'quadratic': bottom-heavy, (i+1)², with linear fallback if largest weight > 40%.
 * 'cubic': strongly bottom-heavy, (i+1)³, no linear fallback — intentional for
 *   ADD_AGGRESSIVELY where concentrating capital at the deepest entry is the goal.
 *
 * Input order is highest-price-first (index 0 = nearest to market).
 * Returns amounts in the same order. Amounts sum exactly to `remaining`.
 */
export function computeTrancheAmounts(remaining: number, count: number, weightMode: WeightMode = 'quadratic'): number[] {
  if (count <= 0 || remaining <= 0) return []
  if (weightMode === 'equal') return Array.from({ length: count }, () => remaining / count)

  if (weightMode === 'cubic') {
    const weights = Array.from({ length: count }, (_, i) => (i + 1) ** 3)
    const total   = weights.reduce((s, w) => s + w, 0)
    return weights.map(w => remaining * w / total)
  }

  // quadratic with linear fallback for small counts where skew would exceed 40%
  const quadWeights  = Array.from({ length: count }, (_, i) => (i + 1) ** 2)
  const quadTotal    = quadWeights.reduce((s, w) => s + w, 0)
  const useQuadratic = Math.max(...quadWeights) / quadTotal <= WEIGHT_CAP
  const weights      = useQuadratic
    ? quadWeights
    : Array.from({ length: count }, (_, i) => i + 1)
  const total = weights.reduce((s, w) => s + w, 0)
  return weights.map(w => remaining * w / total)
}

/**
 * Compute up to `count` tranche prices within the buy zone, CMP-aware.
 *
 * Floor = max(24wkLow, buyLow) in all zones — never price below the recent low or
 * the valuation floor. Ceiling depends on zone:
 *   Above buy (CMP > buyHigh or unknown): ceiling = buyHigh
 *   In buy / Deep (CMP ≤ buyHigh):        ceiling = CMP
 *
 * In deep zone (CMP < buyLow), floor > ceiling → collapses to single tranche at CMP.
 *
 * Price rounding: INR < 500 → nearest 5; ≥ 500 → nearest 10 (other currencies: 0.5 / 1; see snapUnit).
 * Hard cap: no price above CMP. If floor ≥ ceiling, returns single tranche at CMP.
 * Deduplicates after rounding.
 *
 * midLow / midHigh are accepted for API compatibility but unused.
 *
 * ceilingOverride: if set and lower than the computed ceiling, clamps the range
 *   top (e.g. lower-half compression for WAIT in buy zone).
 * deepExtension: fraction of CMP to extend below in deep zone (default 0.05 = 5%).
 *   Spread across count tranches: step = deepExtension / (count - 1).
 */
export function computeTranchePrices(
  buyLow: number,
  buyHigh: number,
  cmp: number | null,
  count = 3,
  fiftyTwoWeekLow?: number | null,
  isIndex = false,
  ceilingOverride?: number | null,
  deepExtension = 0.05,
  currency = 'INR',
): number[] {
  // Floor is the higher of 52-week low and buyLow — never price below either.
  // Exception 1: if 52wkLow >= CMP the price is AT the 52-week low (a favourable
  //   entry), so use buyLow as floor so tranches spread across the buy zone.
  // Exception 2: if the 52wkLow would push floor above the ceiling (e.g. a narrow
  //   buy zone leaves buyHigh below the 52wkLow), fall back to buyLow — the 52wkLow is above
  //   the entire buy zone and is not a useful pricing floor in that case.
  const rawCeiling = (!cmp || cmp > buyHigh) ? buyHigh : cmp
  const ceiling = (ceilingOverride != null && ceilingOverride < rawCeiling) ? ceilingOverride : rawCeiling
  const use52wkLow = fiftyTwoWeekLow != null && (!cmp || fiftyTwoWeekLow < cmp)
  const raw52Floor = use52wkLow ? Math.max(fiftyTwoWeekLow, buyLow) : buyLow
  const floor = raw52Floor <= ceiling ? raw52Floor : buyLow

  // Deep zone (floor >= ceiling): CMP is below buyLow — already strong-buy territory.
  // Index ETFs: spread tranches from (CMP - zone_width) to CMP.
  // All other stocks: spread 2–3 tranches at 5% steps below CMP. Equal-weighted by
  // the caller. No further spreading into unknown downside; 5% steps are realistic
  // limit orders in a fast-moving deep-value situation.
  if (floor >= ceiling) {
    if (isIndex && cmp != null && cmp > 0) {
      const zoneWidth = buyHigh - buyLow
      const deepFloor = Math.max(1, cmp - zoneWidth)
      const deepCeil  = cmp
      if (deepFloor < deepCeil) {
        return computeTranchePrices(deepFloor, deepCeil, cmp, count, fiftyTwoWeekLow, false, null, 0.05, currency)
      }
    }
    const ref        = cmp ?? floor
    const deepCount  = Math.max(2, count)
    const step       = deepCount > 1 ? deepExtension / (deepCount - 1) : 0
    const deepPrices: number[] = []
    for (let i = 0; i < deepCount; i++) {
      deepPrices.push(snapPrice(ref * (1 - step * i), currency))
    }
    return [...new Set(deepPrices)]
  }

  const range = ceiling - floor
  const minGap    = floor * MIN_GAP_RATIO
  const usedCount = Math.max(2, Math.min(count, Math.floor(range / minGap) + 1))

  const prices: number[] = []
  for (let i = 0; i < usedCount; i++) {
    const t = usedCount > 1 ? i / (usedCount - 1) : 0
    prices.push(snapPrice(floor + t * range, currency))
  }

  // Hard cap: no tranche above CMP (snap down so we stay below)
  const capped = cmp
    ? prices.map(p => p <= cmp ? p : Math.floor(cmp / snapUnit(cmp, currency)) * snapUnit(cmp, currency))
    : prices

  return [...new Set(capped)]
}
