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
  'Retail':             { buyLow: 20, buyHigh: 30, midLow: 31, midHigh: 38, trim: 39 },
  // DMART compounder: hist PE floor ~60x; buy = floor ± 10%, mid = 1.1–1.35x floor, trim ≥ 1.55x
  'Retail — compounder':{ buyLow: 54, buyHigh: 66, midLow: 67, midHigh: 81, trim: 93 },
  'Defence':            { buyLow: 25, buyHigh: 40, midLow: 41, midHigh: 50, trim: 51 },
  'Capital Goods':      { buyLow: 28, buyHigh: 35, midLow: 36, midHigh: 44, trim: 45 },
  'Hospitals':          { buyLow: 38, buyHigh: 45, midLow: 46, midHigh: 55, trim: 56 },
  'FMCG':               { buyLow: 35, buyHigh: 50, midLow: 51, midHigh: 60, trim: 61 },
  'Auto OEM':           { buyLow: 10, buyHigh: 12, midLow: 13, midHigh: 15, trim: 16 },
  'Pharma':             { buyLow: 16, buyHigh: 21, midLow: 22, midHigh: 27, trim: 28 },
  'IT/Technology':      { buyLow: 20, buyHigh: 26, midLow: 27, midHigh: 32, trim: 33 },
  'Insurance — General':{ buyLow: 24, buyHigh: 29, midLow: 30, midHigh: 36, trim: 37 },
  // Index/ETF: PE-of-index thresholds; "eps" passed in = etfPrice / niftyPE (computed in generate route)
  'Index/ETF':          { buyLow: 16, buyHigh: 19, midLow: 20, midHigh: 23, trim: 25 },
}

/** Premium Leaders overlay — applied when twoStrongQuarters=true */
const PREMIUM_PE: Partial<Record<StockCategory, Mult>> = {
  'Cap-Light Infra': { buyLow: 32, buyHigh: 38, midLow: 39, midHigh: 47, trim: 48 },
}

const EV: Partial<Record<StockCategory, Mult>> = {
  'Retail':                     { buyLow: 12,  buyHigh: 18,  midLow: 19, midHigh: 23, trim: 24  },
  'Defence':                    { buyLow: 15,  buyHigh: 22,  midLow: 23, midHigh: 27, trim: 28  },
  'Capital Goods':              { buyLow: 14,  buyHigh: 18,  midLow: 19, midHigh: 23, trim: 24  },
  'Asset-heavy Infra/Platforms':{ buyLow: 8,   buyHigh: 14,  midLow: 15, midHigh: 18, trim: 19  },
  'Hospitals':                  { buyLow: 18,  buyHigh: 22,  midLow: 23, midHigh: 28, trim: 29  },
  'Auto OEM':                   { buyLow: 4.5, buyHigh: 5.5, midLow: 6,  midHigh: 7,  trim: 7.5 },
  'Pharma':                     { buyLow: 10,  buyHigh: 13,  midLow: 14, midHigh: 16, trim: 17  },
}

const PB: Partial<Record<StockCategory, Mult>> = {
  'Asset-heavy Infra/Platforms': { buyLow: 1.0, buyHigh: 2.0, midLow: 2.1, midHigh: 2.5, trim: 2.6 },
  'Banks — Private':             { buyLow: 1.6, buyHigh: 1.9, midLow: 2.0, midHigh: 2.5, trim: 2.6 },
  'Insurance — General':         { buyLow: 2.5, buyHigh: 3.2, midLow: 3.3, midHigh: 4.0, trim: 4.1 },
}

const PEV: Partial<Record<StockCategory, Mult>> = {
  'Insurance': { buyLow: 2.4, buyHigh: 2.8, midLow: 2.9, midHigh: 3.4, trim: 3.5 },
}

/** Premium P/EV — Insurance Life when twoStrongQuarters */
const PREMIUM_PEV: Partial<Record<StockCategory, Mult>> = {
  'Insurance': { buyLow: 2.8, buyHigh: 3.2, midLow: 3.3, midHigh: 3.6, trim: 3.8 },
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

/** Pick stricter = lower buy price */
function stricter(a: Raw | null, b: Raw | null): Raw | null {
  if (!a) return b
  if (!b) return a
  const w = a.buyLow <= b.buyLow ? a : b
  return { ...w, anchor: `${a.anchor} vs ${b.anchor} (stricter: ${w.anchor})` }
}

/**
 * Step 2 divergence check: if PE vs EV gap > 25% AND net_debt/EBITDA > 3x,
 * the balance sheet is debt-heavy and PE can mislead — use EV anchor exclusively.
 */
function withDivergenceCheck(pe: Raw | null, ev: Raw | null, netDebt: number, ebitda: number): Raw | null {
  if (!pe || !ev) return pe ?? ev
  const minBuy = Math.min(pe.buyLow, ev.buyLow)
  if (minBuy <= 0) return stricter(pe, ev)
  const gap = Math.abs(pe.buyLow - ev.buyLow) / minBuy
  const netDebtRatio = ebitda > 0 ? netDebt / ebitda : 0
  if (gap > 0.25 && netDebtRatio > 3) {
    return { ...ev, anchor: `${ev.anchor} (divergence: PE suppressed, net_debt/EBITDA=${netDebtRatio.toFixed(1)}x)` }
  }
  return stricter(pe, ev)
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
    case 'Cap-Light Infra':
    case 'FMCG':
      raw = tryPE()
      break

    // Compounder: PE anchor with elevated hist-floor multiples (60x floor, ±10% buy zone)
    case 'Retail — compounder':
      raw = tryPE()
      break

    case 'Retail':
    case 'Defence':
    case 'Auto OEM':
      raw = stricter(tryPE(), tryEV())
      break

    // Step 2 divergence: if PE vs EV gap > 25% and net_debt/EBITDA > 3x, use EV anchor
    case 'Capital Goods':
      raw = withDivergenceCheck(tryPE(), tryEV(), input.netDebt ?? 0, input.ebitda ?? 0)
      break

    case 'Asset-heavy Infra/Platforms':
      raw = stricter(tryEV(), tryPB())
      break

    case 'Hospitals':
      raw = input.isHospitalRampPhase ? tryEV() : tryPE()
      break

    case 'Pharma': {
      const pe = tryPE(), ev = tryEV()
      raw = pe && ev ? stricter(pe, ev) : (pe ?? ev)
      break
    }

    case 'Insurance':
      raw = tryPEV()
      break

    // Insurance General: stricter of PE and PB
    case 'Insurance — General':
      raw = stricter(tryPE(), tryPB())
      break

    case 'Banks — Private':
      raw = tryPB()
      break

    case 'IT/Technology':
      raw = tryPE()
      break

    // Index/ETF: eps passed in = etfPrice/niftyPE — PE multiples give band prices in ₹ ETF terms
    case 'Index/ETF':
      raw = tryPE()
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
 * - CMP above buyHigh: full band range
 * - CMP within band:   ceiling = CMP × 0.92 (2 steps below), floor = buyLow
 *                      if CMP near buyLow, shift window up
 * - CMP below buyLow:  cluster near buyLow ± 3%
 * - No CMP:            full band range
 *
 * Prices are distributed with quadratic skew toward the lower end.
 * Deduplication handles very narrow bands (returns fewer than count).
 */
export function computeTrancheprices(
  buyLow: number,
  buyHigh: number,
  cmp: number | null,
  count = 5,
): number[] {
  let floor: number, ceiling: number
  const bandWidth = buyHigh - buyLow

  if (!cmp || cmp > buyHigh) {
    floor = buyLow
    ceiling = buyHigh
  } else if (cmp >= buyLow) {
    ceiling = cmp * 0.92
    floor = buyLow
    if (ceiling <= floor + bandWidth * 0.05) {
      ceiling = floor + (cmp - floor) * 0.9
      if (ceiling <= floor) ceiling = floor * 1.03
    }
  } else {
    // CMP below buyLow (deep value): cluster around CMP, not buyLow
    floor = cmp * 0.90
    ceiling = cmp
  }

  const range = Math.max(ceiling - floor, 1)
  const prices: number[] = []
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? Math.pow(i / (count - 1), 2) : 0
    prices.push(Math.round(floor + t * range))
  }
  return [...new Set(prices)]
}
