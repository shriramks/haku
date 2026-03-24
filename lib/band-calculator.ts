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
 * get proportionally more capital. Linear weights: index 0 → weight 1, index n-1 → weight n.
 * Input order is highest-price-first (index 0 = nearest to market).
 * Returns amounts in the same order. Amounts sum exactly to `remaining`.
 */
export function computeTrancheAmounts(remaining: number, count: number): number[] {
  if (count <= 0 || remaining <= 0) return []
  const totalWeight = (count * (count + 1)) / 2
  return Array.from({ length: count }, (_, i) => remaining * (i + 1) / totalWeight)
}

/**
 * Compute up to `count` tranche prices within the buy zone, CMP-aware.
 *
 * - CMP above buyHigh or unknown: limit orders across upper half of buy zone (buyLow+50% → buyHigh)
 * - CMP within buy zone:          floor = buyLow × 0.9, ceiling = CMP (never above market)
 * - CMP below buyLow (deep):      floor = CMP, ceiling = buyLow
 *
 * Prices are distributed with linear spacing (equal intervals).
 * Minimum 3% gap between prices — narrow bands automatically reduce count.
 */
export function computeTrancheprices(
  buyLow: number,
  buyHigh: number,
  cmp: number | null,
  midLow = buyHigh,
  midHigh = buyHigh,
  count = 3,
): number[] {
  let floor: number, ceiling: number

  if (!cmp || cmp > buyHigh) {
    // CMP above buy zone or unknown: use upper half of buy zone — lower tranches are unrealistic
    floor = buyLow + (buyHigh - buyLow) * 0.5
    ceiling = buyHigh
  } else if (cmp >= buyLow) {
    // CMP inside buy zone: buy at market and lower — never above current price
    floor = buyLow * 0.9
    ceiling = cmp
  } else {
    // CMP below buyLow (deep value): accumulate from CMP up to buyLow
    floor = cmp
    ceiling = buyLow
  }

  const range = Math.max(ceiling - floor, floor * 0.05)
  // Each tranche should be at least 3% of floor apart — shrink count for narrow bands
  const minGap = floor * 0.03
  const usedCount = Math.max(2, Math.min(count, Math.floor(range / minGap) + 1))
  const prices: number[] = []
  for (let i = 0; i < usedCount; i++) {
    const t = usedCount > 1 ? i / (usedCount - 1) : 0
    prices.push(Math.round(floor + t * range))
  }
  // Hard cap: no tranche ever above CMP regardless of how ceiling was computed
  const capped = cmp ? prices.map(p => Math.min(p, Math.floor(cmp))) : prices
  return [...new Set(capped)]
}
