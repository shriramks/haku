// TypeScript port of BandCalculator.swift
// Implements AI Investment Playbook (Part B) — PE anchor only.
//
// Quality (0–50%): raises all PE multiples — use when you'd pay a premium vs. sector average.
// Stress  (0–50%): lowers all PE multiples — use to discount earnings for a bad scenario.
// Combined factor: (1 + quality/100) × (1 - stress/100) applied uniformly to all multiples.
// Commodity: no PE table defined, always returns null.

import type { StockCategory } from './types'

// ── Multiple tables ──────────────────────────────────────────────────────────

interface Mult { buyLow: number; buyHigh: number; midLow: number; midHigh: number; trim: number }

// Base PE multiples
const PE: Partial<Record<StockCategory, Mult>> = {
  'Cap-Light Infra': { buyLow: 28, buyHigh: 35, midLow: 36, midHigh: 44, trim: 45 },
  'Hospitals':       { buyLow: 38, buyHigh: 45, midLow: 46, midHigh: 55, trim: 56 },
  'FMCG':            { buyLow: 35, buyHigh: 50, midLow: 51, midHigh: 60, trim: 61 },
  'Tobacco Corp':    { buyLow: 20, buyHigh: 25, midLow: 26, midHigh: 30, trim: 31 },
  // Index ETFs: eps = etfPrice / indexPE (computed in generate route)
  'Nifty 50 Index':      { buyLow: 19, buyHigh: 21, midLow: 21, midHigh: 23, trim: 23 },
  'Nifty Next 50 Index': { buyLow: 18, buyHigh: 20, midLow: 20, midHigh: 24, trim: 25 },
}

export const INDEX_CATEGORIES = new Set<StockCategory>(['Nifty 50 Index', 'Nifty Next 50 Index'])


// ── Tranche price constants ───────────────────────────────────────────────────

const SNAP_THRESHOLD  = 500   // ₹500: below this snap to ₹5, at/above snap to ₹10
const SNAP_SMALL      = 5
const SNAP_LARGE      = 10
const MIN_GAP_RATIO   = 0.03  // Minimum %-gap between adjacent tranches
const WEIGHT_CAP      = 0.40  // If largest quadratic weight > 40%, fall back to linear

// ── Public API ───────────────────────────────────────────────────────────────

export interface BandInput {
  category: StockCategory
  /** 0–50 integer. Raises all PE multiples: factor = (1 + quality/100). Default 0. */
  quality: number
  /** 0–50 integer. Lowers all PE multiples: factor = (1 - stress/100). Default 0. */
  stress: number
  eps?: number | null
}

export interface BandResult {
  anchorUsed: string
  buyLow: number
  buyHigh: number
  midLow: number
  midHigh: number
  trimPrice: number
}

export function calculateBands(input: BandInput): BandResult | null {
  const eps = input.eps
  if (!eps || eps <= 0) return null

  const base = PE[input.category]
  if (!base) return null  // Commodity or unknown

  const quality = Math.max(0, Math.min(50, input.quality ?? 0))
  const stress  = Math.max(0, Math.min(50, input.stress  ?? 0))
  const factor  = (1 + quality / 100) * (1 - stress / 100)

  return {
    anchorUsed: 'PE',
    buyLow:    base.buyLow  * factor * eps,
    buyHigh:   base.buyHigh * factor * eps,
    midLow:    base.midLow  * factor * eps,
    midHigh:   base.midHigh * factor * eps,
    trimPrice: base.trim    * factor * eps,
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
  // Exception 2: if the 52wkLow would push floor above the ceiling (e.g. quality/stress
  //   shifts buyHigh below the 52wkLow), fall back to buyLow — the 52wkLow is above
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
