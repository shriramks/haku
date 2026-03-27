// TypeScript port of BandCalculator.swift
// Implements AI Investment Playbook (Part B) — PE anchor only.
//
// Bear: compress buy range to lower half. Mid/Trim unchanged.
// Normal: full range as defined.
// Bull: use explicit premium overlay if defined; otherwise upper half of buy range.
// Nifty 50 Index, Nifty Next 50 Index, Commodity: flags ignored, always normal.
// Trim never moves — it is a valuation ceiling, not a momentum call.

import type { StockCategory, BuyBand } from './types'

// ── Multiple tables ──────────────────────────────────────────────────────────

interface Mult { buyLow: number; buyHigh: number; midLow: number; midHigh: number; trim: number }

// Base PE multiples
const PE: Partial<Record<StockCategory, Mult>> = {
  'Cap-Light Infra': { buyLow: 28, buyHigh: 35, midLow: 36, midHigh: 44, trim: 45 },
  'Hospitals':       { buyLow: 38, buyHigh: 45, midLow: 46, midHigh: 55, trim: 56 },
  'FMCG':            { buyLow: 35, buyHigh: 50, midLow: 51, midHigh: 60, trim: 61 },
  'Tobacco Corp':    { buyLow: 20, buyHigh: 25, midLow: 26, midHigh: 30, trim: 31 },
  // Index ETFs: eps = etfPrice / indexPE (computed in generate route)
  'Nifty 50 Index':      { buyLow: 18, buyHigh: 20, midLow: 20, midHigh: 22, trim: 24 },
  'Nifty Next 50 Index': { buyLow: 18, buyHigh: 21, midLow: 21, midHigh: 25, trim: 28 },
}

// Explicit bull (premium) overlays — only where the playbook defines them
const PREMIUM: Partial<Record<StockCategory, Mult>> = {
  'Cap-Light Infra': { buyLow: 32, buyHigh: 38, midLow: 39, midHigh: 47, trim: 48 },
}

// Categories where bear/bull quarter flags are ignored (index ETFs, commodities)
export const CATEGORIES_WITHOUT_QUARTERS = new Set<StockCategory>(['Nifty 50 Index', 'Nifty Next 50 Index', 'Commodity'])
const FLAGS_IGNORED = CATEGORIES_WITHOUT_QUARTERS


// ── Tranche price constants ───────────────────────────────────────────────────

const SNAP_THRESHOLD  = 500   // ₹500: below this snap to ₹5, at/above snap to ₹10
const SNAP_SMALL      = 5
const SNAP_LARGE      = 10
const MIN_GAP_RATIO   = 0.03  // Minimum %-gap between adjacent tranches
const WEIGHT_CAP      = 0.40  // If largest quadratic weight > 40%, fall back to linear

// ── Public API ───────────────────────────────────────────────────────────────

export interface BandInput {
  category: StockCategory
  twoWeakQuarters: boolean
  twoStrongQuarters: boolean
  eps?: number | null
}

export interface BandResult {
  anchorUsed: string
  buyLow: number
  buyHigh: number
  midLow: number
  midHigh: number
  trimPrice: number
  isTightened: boolean
  isPremium: boolean
}

export function calculateBands(input: BandInput): BandResult | null {
  const eps = input.eps
  if (!eps || eps <= 0) return null

  const base = PE[input.category]
  if (!base) return null  // Commodity or unknown

  // Bear wins if both flags set; flags ignored for index/commodity
  const isBear = !FLAGS_IGNORED.has(input.category) && input.twoWeakQuarters
  const isBull = !FLAGS_IGNORED.has(input.category) && input.twoStrongQuarters && !isBear

  let m: Mult
  if (isBear) {
    const midpoint = base.buyLow + (base.buyHigh - base.buyLow) / 2
    m = { ...base, buyHigh: midpoint }
  } else if (isBull) {
    const premium = PREMIUM[input.category]
    if (premium) {
      m = premium
    } else {
      // Upper half formula — bull buys in the upper half of the buy range
      const midpoint = base.buyLow + (base.buyHigh - base.buyLow) / 2
      m = { ...base, buyLow: midpoint }
    }
  } else {
    m = base
  }

  const suffix = isBear ? ' (bear)' : isBull ? ' (bull)' : ''
  return {
    anchorUsed: 'PE' + suffix,
    buyLow:     m.buyLow  * eps,
    buyHigh:    m.buyHigh * eps,
    midLow:     m.midLow  * eps,
    midHigh:    m.midHigh * eps,
    trimPrice:  m.trim    * eps,
    isTightened: isBear,
    isPremium:   isBull,
  }
}

// ── Band signal from CMP ─────────────────────────────────────────────────────

export function getBandSignal(band: BuyBand): import('./types').BandSignal {
  const { manual_cmp: cmp, buy_low, buy_high, mid_low, mid_high, trim_price } = band
  if (cmp === null || buy_low === null || trim_price === null) return 'unknown'
  if (cmp < buy_low)                                          return 'deep'
  if (cmp <= (buy_high ?? mid_low ?? trim_price))            return 'buy'
  if (cmp <= (mid_high ?? trim_price))                       return 'hold'
  return 'trim'
}

/** Tranche suggestion: 1–2% of total capital, capped at remaining */
export function trancheSuggestion(remainingBudget: number, totalCapital: number): number {
  const onePct = totalCapital * 0.01
  const twoPct = totalCapital * 0.02
  return Math.min(twoPct, Math.max(onePct, remainingBudget * 0.33))
}

/**
 * Conviction-weighted tranche amounts: deeper tranches (higher index = lower price)
 * get proportionally more capital. Uses quadratic weights (i+1)² by default.
 *
 * Weight cap: if the largest quadratic weight exceeds 40% of the total, falls back
 * to linear weights (i+1) to avoid a single tranche dominating (e.g. 80/20 on 2 tranches).
 * Linear weights on 2 tranches → 33%/67% — still bottom-biased but balanced.
 *
 * Input order is highest-price-first (index 0 = nearest to market).
 * Returns amounts in the same order. Amounts sum exactly to `remaining`.
 */
export function computeTrancheAmounts(remaining: number, count: number): number[] {
  if (count <= 0 || remaining <= 0) return []
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
export function computeTrancheprices(
  buyLow: number,
  buyHigh: number,
  cmp: number | null,
  midLow = buyHigh,   // unused — kept for call-site compat
  midHigh = buyHigh,  // unused — kept for call-site compat
  count = 3,
  twentyFourWeekLow?: number | null,
): number[] {
  void midLow; void midHigh

  // Floor is the higher of 24-week low and buyLow — never price below either.
  // Exception: if 24wkLow >= CMP the price is AT the 6-month low, which is a
  // favourable entry. Use buyLow as floor so tranches spread across the buy zone.
  const use24wkLow = twentyFourWeekLow != null && (!cmp || twentyFourWeekLow < cmp)
  const floor   = use24wkLow ? Math.max(twentyFourWeekLow, buyLow) : buyLow
  const ceiling = (!cmp || cmp > buyHigh) ? buyHigh : cmp

  // Collapse to single tranche at CMP if floor >= ceiling
  if (floor >= ceiling) {
    const ref  = cmp ?? floor
    const snap = ref < SNAP_THRESHOLD ? SNAP_SMALL : SNAP_LARGE
    return [Math.floor(ref / snap) * snap]
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
