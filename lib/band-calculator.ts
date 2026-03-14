// TypeScript port of BandCalculator.swift
// Implements AI Investment Playbook (Part B)
//
// EV/EBITDA formula (all in ₹Cr / Cr-shares):
//   price (₹) = (multiple × ebitda − net_debt) / shares
//
// P/EV formula:
//   evPerShare (₹) = embedded_value (₹Cr) / shares (Cr)
//   price (₹) = multiple × evPerShare

import type { StockCategory, BuyBand } from './types'

// ── Multiple tables ──────────────────────────────────────────────────────────

interface Mult { buyLow: number; buyHigh: number; midLow: number; midHigh: number; trim: number }

const PE: Partial<Record<StockCategory, Mult>> = {
  'Cap-Light Infra':    { buyLow: 28, buyHigh: 35, midLow: 36, midHigh: 44, trim: 45 },
  // All Retail treated as quality compounders; hist PE floor ~60x
  'Retail':             { buyLow: 54, buyHigh: 66, midLow: 67, midHigh: 81, trim: 93 },
  'Defence':            { buyLow: 25, buyHigh: 40, midLow: 41, midHigh: 50, trim: 51 },
  'Capital Goods':      { buyLow: 28, buyHigh: 35, midLow: 36, midHigh: 44, trim: 45 },
  'Hospitals':          { buyLow: 38, buyHigh: 45, midLow: 46, midHigh: 55, trim: 56 },
  'FMCG':               { buyLow: 35, buyHigh: 50, midLow: 51, midHigh: 60, trim: 61 },
  'Auto OEM':           { buyLow: 10, buyHigh: 12, midLow: 13, midHigh: 15, trim: 16 },
  'Pharma':             { buyLow: 22, buyHigh: 28, midLow: 29, midHigh: 35, trim: 38 },
  'IT/Technology':      { buyLow: 20, buyHigh: 26, midLow: 27, midHigh: 32, trim: 33 },
  // Index/ETF: Nifty PE thresholds; "eps" passed in = etfPrice / niftyPE (computed in generate route)
  'Index/ETF':          { buyLow: 16, buyHigh: 19, midLow: 20, midHigh: 23, trim: 25 },
}

/** Premium Leaders overlay — applied when twoStrongQuarters=true */
const PREMIUM_PE: Partial<Record<StockCategory, Mult>> = {
  'Cap-Light Infra': { buyLow: 32, buyHigh: 38, midLow: 39, midHigh: 47, trim: 48 },
}

const EV: Partial<Record<StockCategory, Mult>> = {
  'Defence':      { buyLow: 15,  buyHigh: 22,  midLow: 23, midHigh: 27, trim: 28  },
  'Capital Goods':{ buyLow: 14,  buyHigh: 18,  midLow: 19, midHigh: 23, trim: 24  },
  'Hospitals':    { buyLow: 18,  buyHigh: 22,  midLow: 23, midHigh: 28, trim: 29  },
  'Auto OEM':     { buyLow: 4.5, buyHigh: 5.5, midLow: 6,  midHigh: 7,  trim: 7.5 },
  'Pharma':       { buyLow: 10,  buyHigh: 13,  midLow: 14, midHigh: 16, trim: 17  },
}

const PB: Partial<Record<StockCategory, Mult>> = {
  'Banks':               { buyLow: 1.6, buyHigh: 1.9, midLow: 2.0, midHigh: 2.5, trim: 2.6 },
  'Insurance — General': { buyLow: 2.5, buyHigh: 3.2, midLow: 3.3, midHigh: 4.0, trim: 4.1 },
}

const PEV: Partial<Record<StockCategory, Mult>> = {
  'Insurance — Life': { buyLow: 2.4, buyHigh: 2.8, midLow: 2.9, midHigh: 3.4, trim: 3.5 },
}

/** Premium P/EV — Insurance Life when twoStrongQuarters */
const PREMIUM_PEV: Partial<Record<StockCategory, Mult>> = {
  'Insurance — Life': { buyLow: 2.8, buyHigh: 3.2, midLow: 3.3, midHigh: 3.6, trim: 3.8 },
}

// ── Internal raw band ────────────────────────────────────────────────────────

interface Raw { anchor: string; buyLow: number; buyHigh: number; midLow: number; midHigh: number; trim: number }

function fromPE(m: Mult, eps: number): Raw {
  return { anchor: 'PE', buyLow: m.buyLow*eps, buyHigh: m.buyHigh*eps,
           midLow: m.midLow*eps, midHigh: m.midHigh*eps, trim: m.trim*eps }
}

function fromPB(m: Mult, bvps: number): Raw {
  return { anchor: 'PB', buyLow: m.buyLow*bvps, buyHigh: m.buyHigh*bvps,
           midLow: m.midLow*bvps, midHigh: m.midHigh*bvps, trim: m.trim*bvps }
}

function fromEV(m: Mult, ebitda: number, netDebt: number, shares: number): Raw | null {
  if (shares <= 0) return null
  const p = (mult: number) => (mult * ebitda - netDebt) / shares
  return { anchor: 'EV/EBITDA', buyLow: p(m.buyLow), buyHigh: p(m.buyHigh),
           midLow: p(m.midLow), midHigh: p(m.midHigh), trim: p(m.trim) }
}

function fromPEV(m: Mult, ev: number, shares: number): Raw | null {
  if (shares <= 0) return null
  const evps = ev / shares
  return { anchor: 'P/EV', buyLow: m.buyLow*evps, buyHigh: m.buyHigh*evps,
           midLow: m.midLow*evps, midHigh: m.midHigh*evps, trim: m.trim*evps }
}


// ── Public API ───────────────────────────────────────────────────────────────

export interface BandInput {
  category: StockCategory
  twoWeakQuarters: boolean
  twoStrongQuarters: boolean
  isHospitalRampPhase: boolean
  eps?: number | null
  bvps?: number | null
  ebitda?: number | null
  netDebt?: number | null
  shares?: number | null
  embeddedValue?: number | null
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
  // twoWeakQuarters takes precedence if both are set
  const tighten  = input.twoWeakQuarters
  const premium  = input.twoStrongQuarters && !tighten

  const tryPE = (): Raw | null => {
    // Use premium multiples if applicable
    const mTable = (premium && PREMIUM_PE[input.category]) ? PREMIUM_PE : PE
    const m = mTable[input.category]; const eps = input.eps
    if (!m || !eps || eps <= 0) return null
    return fromPE(m, eps)
  }

  const tryEV = (): Raw | null => {
    const m = EV[input.category]; const { ebitda, shares } = input
    if (!m || !ebitda || ebitda <= 0 || !shares || shares <= 0) return null
    return fromEV(m, ebitda, input.netDebt ?? 0, shares)
  }

  const tryPB = (): Raw | null => {
    const m = PB[input.category]; const bvps = input.bvps
    if (!m || !bvps || bvps <= 0) return null
    return fromPB(m, bvps)
  }

  const tryPEV = (): Raw | null => {
    const mTable = (premium && PREMIUM_PEV[input.category]) ? PREMIUM_PEV : PEV
    const m = mTable[input.category]; const { embeddedValue, shares } = input
    if (!m || !embeddedValue || embeddedValue <= 0 || !shares || shares <= 0) return null
    return fromPEV(m, embeddedValue, shares)
  }

  let raw: Raw | null = null

  switch (input.category) {
    case 'Index/ETF':
    case 'Cap-Light Infra':
    case 'Retail':
    case 'Defence':
    case 'FMCG':
    case 'Auto OEM':
    case 'Pharma':
    case 'IT/Technology':
      raw = tryPE()
      break

    case 'Capital Goods':
      raw = tryEV()
      break

    case 'Hospitals':
      raw = input.isHospitalRampPhase ? tryEV() : tryPE()
      break

    case 'Insurance — Life':
      raw = tryPEV()
      break

    case 'Insurance — General':
    case 'Banks':
      raw = tryPB()
      break
  }

  if (!raw) return null

  // Tightening: reduce all band prices by 10% (trim unchanged)
  const f = tighten ? 0.90 : 1.0
  const suffix = tighten ? ' (tightened)' : premium ? ' (premium)' : ''

  return {
    anchorUsed:  raw.anchor + suffix,
    buyLow:      raw.buyLow  * (tighten ? 0.90 : 1),
    buyHigh:     raw.buyHigh * f,
    midLow:      raw.midLow  * f,
    midHigh:     raw.midHigh * f,
    trimPrice:   raw.trim,
    isTightened: tighten,
    isPremium:   premium,
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
 * Compute up to `count` tranche prices within the buy zone, CMP-aware.
 *
 * - CMP above buyHigh or unknown: limit orders across buyLow → buyHigh
 * - CMP within buy zone:          floor = buyLow × 0.9, ceiling = CMP (never above market)
 * - CMP below buyLow (deep):      floor = CMP, ceiling = buyLow
 *
 * Prices are distributed with quadratic skew toward the lower end.
 * Deduplication handles very narrow bands (returns fewer than count).
 */
export function computeTrancheprices(
  buyLow: number,
  buyHigh: number,
  cmp: number | null,
  midLow = buyHigh,
  midHigh = buyHigh,
  count = 5,
): number[] {
  let floor: number, ceiling: number

  if (!cmp || cmp > buyHigh) {
    // CMP above buy zone or unknown: limit orders across the buy zone only
    floor = buyLow
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
  // Each tranche should be at least 2% of floor apart — shrink count for narrow bands
  const minGap = floor * 0.02
  const usedCount = Math.max(2, Math.min(count, Math.floor(range / minGap) + 1))
  const prices: number[] = []
  for (let i = 0; i < usedCount; i++) {
    const t = usedCount > 1 ? Math.pow(i / (usedCount - 1), 2) : 0
    prices.push(Math.round(floor + t * range))
  }
  return [...new Set(prices)]
}
