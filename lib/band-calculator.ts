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
  'Capital-light Market Infra/Services': { buyLow: 28, buyHigh: 35, midLow: 36, midHigh: 44, trim: 45 },
  'Retail':                              { buyLow: 20, buyHigh: 30, midLow: 31, midHigh: 38, trim: 39 },
  'Defence':                             { buyLow: 25, buyHigh: 40, midLow: 41, midHigh: 50, trim: 51 },
  'Electricals/Capital Goods':           { buyLow: 28, buyHigh: 35, midLow: 36, midHigh: 44, trim: 45 },
  'Hospitals':                           { buyLow: 38, buyHigh: 45, midLow: 46, midHigh: 55, trim: 56 },
  'FMCG':                                { buyLow: 35, buyHigh: 50, midLow: 51, midHigh: 60, trim: 61 },
  'Auto OEM':                            { buyLow: 10, buyHigh: 12, midLow: 13, midHigh: 15, trim: 16 },
  'Pharma':                              { buyLow: 16, buyHigh: 21, midLow: 22, midHigh: 27, trim: 28 },
  'IT/Technology':                       { buyLow: 20, buyHigh: 26, midLow: 27, midHigh: 32, trim: 33 },
  // Index/ETF: PE-of-index thresholds; "eps" passed in = etfPrice / niftyPE (computed in generate route)
  'Index/ETF':                           { buyLow: 16, buyHigh: 19, midLow: 20, midHigh: 23, trim: 25 },
}

/** Premium Leaders overlay — applied when twoStrongQuarters=true */
const PREMIUM_PE: Partial<Record<StockCategory, Mult>> = {
  'Capital-light Market Infra/Services': { buyLow: 32, buyHigh: 38, midLow: 39, midHigh: 47, trim: 48 },
}

const EV: Partial<Record<StockCategory, Mult>> = {
  'Retail':                     { buyLow: 12,  buyHigh: 18,  midLow: 19, midHigh: 23, trim: 24  },
  'Defence':                    { buyLow: 15,  buyHigh: 22,  midLow: 23, midHigh: 27, trim: 28  },
  'Asset-heavy Infra/Platforms':{ buyLow: 8,   buyHigh: 14,  midLow: 15, midHigh: 18, trim: 19  },
  'Hospitals':                  { buyLow: 18,  buyHigh: 22,  midLow: 23, midHigh: 28, trim: 29  },
  'Auto OEM':                   { buyLow: 4.5, buyHigh: 5.5, midLow: 6,  midHigh: 7,  trim: 7.5 },
  'Pharma':                     { buyLow: 10,  buyHigh: 13,  midLow: 14, midHigh: 16, trim: 17  },
}

const PB: Partial<Record<StockCategory, Mult>> = {
  'Asset-heavy Infra/Platforms': { buyLow: 1.0, buyHigh: 2.0, midLow: 2.1, midHigh: 2.5, trim: 2.6 },
}

const PEV: Partial<Record<StockCategory, Mult>> = {
  'Insurance': { buyLow: 2.4, buyHigh: 2.8, midLow: 2.9, midHigh: 3.4, trim: 3.6 },
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
    const m = PEV[input.category]; const { embeddedValue, shares } = input
    if (!m || !embeddedValue || embeddedValue <= 0 || !shares || shares <= 0) return null
    return fromPEV(m, embeddedValue, shares)
  }

  let raw: Raw | null = null

  switch (input.category) {
    case 'Capital-light Market Infra/Services':
    case 'Electricals/Capital Goods':
    case 'FMCG':
      raw = tryPE()
      break

    case 'Retail':
    case 'Defence':
    case 'Auto OEM':
      raw = stricter(tryPE(), tryEV())
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
