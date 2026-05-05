// AI Investment Playbook v9 — band computation.
// Part B: DDM-factor PE bands for individual stocks.
// Part C: Index ETF PE bands — factor always 1, different PE thresholds.

import type { StockCategory } from './types'

// ── Multiple tables ──────────────────────────────────────────────────────────

interface Mult { buyLow: number; buyHigh: number; midLow: number; midHigh: number; trim: number }

const PE: Partial<Record<StockCategory, Mult>> = {
  'Cap-Light Infra': { buyLow: 28, buyHigh: 35, midLow: 36, midHigh: 44, trim: 45 },
  'Hospitals':       { buyLow: 38, buyHigh: 45, midLow: 46, midHigh: 55, trim: 56 },
  'Branded Pharma':  { buyLow: 20, buyHigh: 26, midLow: 27, midHigh: 32, trim: 33 },
  'Tobacco Corp':    { buyLow: 20, buyHigh: 25, midLow: 26, midHigh: 30, trim: 31 },
  // Index ETFs (v9): eps = indexLevel / indexPE / 100
  'Nifty 50 Index':      { buyLow: 18, buyHigh: 20, midLow: 20, midHigh: 22, trim: 24 },
  'Nifty Next 50 Index': { buyLow: 22, buyHigh: 25, midLow: 25, midHigh: 28, trim: 32 },
}

export const INDEX_CATEGORIES = new Set<StockCategory>(['Nifty 50 Index', 'Nifty Next 50 Index'])

// ── Factor computation constants ──────────────────────────────────────────────

const CATEGORY_MIDPOINT_PE: Partial<Record<StockCategory, number>> = {
  'Tobacco Corp':    22.5,
  'Cap-Light Infra': 31.5,
  'Hospitals':       41.5,
  'Branded Pharma':  23.0,
}

const ROCE_THRESHOLDS: Partial<Record<StockCategory, number>> = {
  'Cap-Light Infra': 22,
  'Tobacco Corp':    20,
  'Hospitals':       16,
  'Branded Pharma':  18,
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
  return ROCE_THRESHOLDS[category] ?? null
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

export function deriveIndexEps(indexLevel: number | null, indexPE: number | null): number | null {
  return (indexLevel != null && indexPE != null && indexPE > 0)
    ? indexLevel / indexPE / 100
    : null
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

// ── Tranche price constants ───────────────────────────────────────────────────

const SNAP_THRESHOLD  = 500   // ₹500: below this snap to ₹5, at/above snap to ₹10
const SNAP_SMALL      = 5
const SNAP_LARGE      = 10
const MIN_GAP_RATIO   = 0.03  // Minimum %-gap between adjacent tranches
const WEIGHT_CAP      = 0.40  // If largest quadratic weight > 40%, fall back to linear

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

  const base = PE[input.category]
  if (!base) return null

  if (INDEX_CATEGORIES.has(input.category)) {
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
  const midpointPE = CATEGORY_MIDPOINT_PE[input.category] ?? null

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
): number | null {
  const isDeep = liveCmp !== null && liveCmp < buyLow
  if (!isDeep || minBuyPrice === null) return liveCmp
  const snap = minBuyPrice < 500 ? 5 : 10
  return Math.min(liveCmp, minBuyPrice - snap)
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
 * equal=true (Case A above zone, Case C deep zone): equal split — probability of
 * any given tranche filling is uncertain, so don't over-bet on the deepest one.
 *
 * equal=false (Case B inside zone): conviction-weighted — deeper tranches get more
 * capital. Uses quadratic weights (i+1)² when the largest weight ≤ 40% of total,
 * otherwise falls back to linear (i+1) to avoid extreme skew on small counts.
 *
 * Input order is highest-price-first (index 0 = nearest to market).
 * Returns amounts in the same order. Amounts sum exactly to `remaining`.
 */
export function computeTrancheAmounts(remaining: number, count: number, equal = false): number[] {
  if (count <= 0 || remaining <= 0) return []
  if (equal) return Array.from({ length: count }, () => remaining / count)
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
 * Price rounding: < ₹500 → nearest ₹5; ≥ ₹500 → nearest ₹10.
 * Hard cap: no price above CMP. If floor ≥ ceiling, returns single tranche at CMP.
 * Deduplicates after rounding.
 *
 * midLow / midHigh are accepted for API compatibility but unused.
 */
export function computeTranchePrices(
  buyLow: number,
  buyHigh: number,
  cmp: number | null,
  count = 3,
  fiftyTwoWeekLow?: number | null,
  isIndex = false,
): number[] {
  // Floor is the higher of 52-week low and buyLow — never price below either.
  // Exception 1: if 52wkLow >= CMP the price is AT the 52-week low (a favourable
  //   entry), so use buyLow as floor so tranches spread across the buy zone.
  // Exception 2: if the 52wkLow would push floor above the ceiling (e.g. a narrow
  //   buy zone leaves buyHigh below the 52wkLow), fall back to buyLow — the 52wkLow is above
  //   the entire buy zone and is not a useful pricing floor in that case.
  const ceiling = (!cmp || cmp > buyHigh) ? buyHigh : cmp
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
        return computeTranchePrices(deepFloor, deepCeil, cmp, count, fiftyTwoWeekLow, false)
      }
    }
    const ref        = cmp ?? floor
    const deepCount  = Math.min(Math.max(2, count), 3)
    const deepPrices: number[] = []
    for (let i = 0; i < deepCount; i++) {
      const raw  = ref * (1 - 0.05 * i)
      const snap = raw < SNAP_THRESHOLD ? SNAP_SMALL : SNAP_LARGE
      deepPrices.push(Math.round(raw / snap) * snap)
    }
    return [...new Set(deepPrices)]
  }

  const range = ceiling - floor
  const minGap    = floor * MIN_GAP_RATIO
  const usedCount = Math.max(2, Math.min(count, Math.floor(range / minGap) + 1))

  const prices: number[] = []
  for (let i = 0; i < usedCount; i++) {
    const t    = usedCount > 1 ? i / (usedCount - 1) : 0
    const raw  = floor + t * range
    const snap = raw < SNAP_THRESHOLD ? SNAP_SMALL : SNAP_LARGE
    prices.push(Math.round(raw / snap) * snap)
  }

  // Hard cap: no tranche above CMP (snap down so we stay below)
  const capped = cmp
    ? prices.map(p => {
        if (p <= cmp) return p
        const snap = cmp < SNAP_THRESHOLD ? SNAP_SMALL : SNAP_LARGE
        return Math.floor(cmp / snap) * snap
      })
    : prices

  return [...new Set(capped)]
}
