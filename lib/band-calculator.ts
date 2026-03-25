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

// Categories where bear/bull flags are ignored
const FLAGS_IGNORED = new Set<StockCategory>(['Nifty 50 Index', 'Nifty Next 50 Index', 'Commodity'])


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
  const useQuadratic = Math.max(...quadWeights) / quadTotal <= 0.40
  const weights      = useQuadratic
    ? quadWeights
    : Array.from({ length: count }, (_, i) => i + 1)
  const total = weights.reduce((s, w) => s + w, 0)
  return weights.map(w => remaining * w / total)
}

/**
 * Compute up to `count` tranche prices within the buy zone, CMP-aware.
 *
 * Zone detection:
 *   Above buy  (CMP > buyHigh or unknown): floor = buyLow,   ceiling = buyHigh
 *   In buy     (buyLow ≤ CMP ≤ buyHigh):   floor = max(24wkLow×0.98, buyLow×0.95), ceiling = CMP
 *   Deep       (CMP < buyLow):             floor = max(24wkLow×0.98, CMP×0.97),    ceiling = buyLow
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

  let floor: number, ceiling: number

  if (!cmp || cmp > buyHigh) {
    // Above buy zone (or unknown CMP): spread across full buy range
    floor   = buyLow
    ceiling = buyHigh
  } else if (cmp >= buyLow) {
    // CMP inside buy zone
    const wkFloor = twentyFourWeekLow ? twentyFourWeekLow * 0.98 : 0
    floor   = Math.max(wkFloor, buyLow * 0.95)
    ceiling = cmp
  } else {
    // CMP below buyLow (deep) — ceiling is CMP (not buyLow) because hard cap would kill
    // anything above CMP anyway, collapsing to a single tranche. 0.93 gives ~7% range
    // for 2–3 tranches after rounding.
    const wkFloor = twentyFourWeekLow ? twentyFourWeekLow * 0.98 : 0
    floor   = Math.max(wkFloor, cmp * 0.93)
    ceiling = cmp
  }

  // Collapse to single tranche at CMP if floor >= ceiling
  if (floor >= ceiling) {
    const ref  = cmp ?? floor
    const snap = ref < 500 ? 5 : 10
    return [Math.floor(ref / snap) * snap]
  }

  const range = ceiling - floor
  const minGap    = floor * 0.03
  const usedCount = Math.max(2, Math.min(count, Math.floor(range / minGap) + 1))

  const prices: number[] = []
  for (let i = 0; i < usedCount; i++) {
    const t    = usedCount > 1 ? i / (usedCount - 1) : 0
    const raw  = floor + t * range
    const snap = raw < 500 ? 5 : 10
    prices.push(Math.round(raw / snap) * snap)
  }

  // Hard cap: no tranche above CMP (snap down so we stay below)
  const capped = cmp
    ? prices.map(p => {
        if (p <= cmp) return p
        const snap = cmp < 500 ? 5 : 10
        return Math.floor(cmp / snap) * snap
      })
    : prices

  return [...new Set(capped)]
}
