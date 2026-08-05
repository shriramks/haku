import type { Transaction } from './types'
import type { MFund, MFTransaction, SGBTransaction } from './portfolio-types'

export type AssetType = 'stock' | 'mf' | 'gold'
export type GainType  = 'STCG'  | 'LTCG'

export function mfAssetClass(fund: { scheme_type: string; scheme_name: string }): 'equity' | 'debt' {
  const t = `${fund.scheme_type} ${fund.scheme_name}`.toLowerCase()
  if (t.includes('debt') || t.includes('liquid') || t.includes('fixed') || t.includes('bond') ||
      t.includes('overnight') || t.includes('duration') || t.includes('arbitrage') ||
      t.includes('gilt') || t.includes('money market') || t.includes('treasury')) return 'debt'
  return 'equity'
}

export interface RealisedGain {
  assetType:    AssetType
  symbol:       string
  sellDate:     string
  purchaseDate: string
  holdingDays:  number
  gainType:     GainType
  qty:          number
  saleValue:    number
  purchaseCost: number
  gain:         number
}

export interface UnrealisedPosition {
  assetType:    AssetType
  symbol:       string
  purchaseDate: string
  qty:          number
  costPerUnit:  number
  purchaseCost: number
  currentValue: number | null
  gain:         number | null
  holdingDays:  number
  gainType:     GainType
}

interface OpenLot {
  purchaseDate: string
  qty:          number
  costPerUnit:  number
  fmvJan2018:  number | null  // non-null only for pre-2018 MF lots
}

export const LTCG_DAYS_EQUITY = 365
export const LTCG_DAYS_GOLD   = 1095
export const LTCG_DAYS_DEBT   = 730  // 24 months — Budget 2024 unified non-equity threshold
// Finance Act 2023 s.50AA: debt MF units bought on/after this date get no LTCG
// treatment at all — always taxed at slab, regardless of holding period.
export const DEBT_SLAB_CUTOFF = '2023-04-01'
const GRANDFATHER_DATE = '2018-01-31'
const EPSILON          = 1e-6

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

// Classifies a lot into LTCG/STCG given its holding period. `assetType` /
// `symbol` are for RealisedGain tagging only — the actual bucket a debt or
// gold-ETF gain lands in downstream is decided entirely by this function via
// the classify callback passed to fifoConsume, not by assetType.
type Classify = (lot: OpenLot, holdingDays: number) => GainType

function classifyByDays(thresholdDays: number): Classify {
  return (_lot, holdingDays) => holdingDays >= thresholdDays ? 'LTCG' : 'STCG'
}

// Debt MF (and, by the same rate mechanics, gold ETF folded into the debt
// bucket for tax purposes): units bought on/after the s.50AA cutoff are
// always STCG (slab), regardless of holding period. Earlier units get LTCG
// at the 24-month threshold. Gold ETF has no such purchase-date cutoff — call
// classifyByDays(LTCG_DAYS_DEBT) for that case instead.
function classifyDebtMF(lot: OpenLot, holdingDays: number): GainType {
  if (lot.purchaseDate >= DEBT_SLAB_CUTOFF) return 'STCG'
  return holdingDays >= LTCG_DAYS_DEBT ? 'LTCG' : 'STCG'
}

// Pre-2018 LTCG grandfathering (equity MFs only):
// effective cost = max(actual_cost, min(fmv_jan2018, sale_price))
// prevents creating an artificial loss when FMV > sale price
function grandfatheredCost(lot: OpenLot, salePricePerUnit: number, gainType: GainType): number {
  if (gainType === 'LTCG' && lot.fmvJan2018 !== null) {
    return Math.max(lot.costPerUnit, Math.min(lot.fmvJan2018, salePricePerUnit))
  }
  return lot.costPerUnit
}

function sortTxns<T extends { trade_date: string; trade_type: string }>(txns: T[]): T[] {
  return [...txns].sort((a, b) => {
    if (a.trade_date !== b.trade_date) return a.trade_date < b.trade_date ? -1 : 1
    // buys before sells on the same date (mirrors existing mf-compute ordering assumption)
    return a.trade_type === b.trade_type ? 0 : a.trade_type === 'buy' ? -1 : 1
  })
}

// Consumes buy lots FIFO for one sell. Mutates `lots`. Returns one RealisedGain
// per lot (or partial lot) consumed; entries outside fyRange are omitted from
// the return value but FIFO state is still advanced so subsequent sells are correct.
function fifoConsume(
  lots:             OpenLot[],
  sellDate:         string,
  sellQty:          number,
  salePricePerUnit: number,
  assetType:        AssetType,
  symbol:           string,
  fyRange:          { start: string; end: string },
  classify:         Classify,
): RealisedGain[] {
  const gains: RealisedGain[] = []
  const inFY = sellDate >= fyRange.start && sellDate <= fyRange.end
  let remaining = sellQty

  while (remaining > EPSILON && lots.length > 0) {
    const lot      = lots[0]
    const consumed = Math.min(lot.qty, remaining)

    const holdingDays = daysBetween(lot.purchaseDate, sellDate)
    const gainType    = classify(lot, holdingDays)
    const costPerUnit = grandfatheredCost(lot, salePricePerUnit, gainType)

    if (inFY) {
      gains.push({
        assetType,
        symbol,
        sellDate,
        purchaseDate: lot.purchaseDate,
        holdingDays,
        gainType,
        qty:          consumed,
        saleValue:    consumed * salePricePerUnit,
        purchaseCost: consumed * costPerUnit,
        gain:         consumed * (salePricePerUnit - costPerUnit),
      })
    }

    remaining -= consumed
    if (lot.qty - consumed < EPSILON) {
      lots.shift()
    } else {
      lot.qty -= consumed
    }
  }

  return gains
}

// ── Stock ─────────────────────────────────────────────────────────────────────

export function computeStockGains(
  txns:    Transaction[],
  symbol:  string,
  cmp:     number | null,
  fyRange: { start: string; end: string },
  asOf:    string,
): { realised: RealisedGain[]; unrealised: UnrealisedPosition[] } {
  const lots:     OpenLot[]      = []
  const realised: RealisedGain[] = []
  const classify = classifyByDays(LTCG_DAYS_EQUITY)

  for (const txn of sortTxns(txns)) {
    if (txn.trade_type === 'buy') {
      lots.push({ purchaseDate: txn.trade_date, qty: txn.quantity, costPerUnit: txn.price, fmvJan2018: null })
    } else {
      realised.push(...fifoConsume(lots, txn.trade_date, txn.quantity, txn.price, 'stock', symbol, fyRange, classify))
    }
  }

  const unrealised: UnrealisedPosition[] = lots.map(lot => {
    const holdingDays  = daysBetween(lot.purchaseDate, asOf)
    const gainType     = classify(lot, holdingDays)
    const currentValue = cmp !== null ? lot.qty * cmp : null
    const gain         = currentValue !== null ? currentValue - lot.qty * lot.costPerUnit : null
    return { assetType: 'stock' as AssetType, symbol, purchaseDate: lot.purchaseDate, qty: lot.qty, costPerUnit: lot.costPerUnit, purchaseCost: lot.qty * lot.costPerUnit, currentValue, gain, holdingDays, gainType }
  })

  return { realised, unrealised }
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const arr = map.get(k) ?? []; arr.push(item); map.set(k, arr)
  }
  return map
}

export function netStockQty(txns: Transaction[]): number {
  return txns.reduce((sum, t) => sum + (t.trade_type === 'buy' ? t.quantity : -t.quantity), 0)
}

export function netStockQtyAsOf(txns: Transaction[], date: string): number {
  return netStockQty(txns.filter(t => t.trade_date <= date))
}

// ── MF ───────────────────────────────────────────────────────────────────────

// assetClass: from mfAssetClass(fund) — decides the LTCG threshold and, for
// debt, whether the s.50AA slab-only cutoff applies.
// fmvJan2018: NAV on Jan 31 2018 for this fund (equity only — debt funds have
// no grandfather rule), null if the fund had no pre-2018 units or the value
// hasn't been fetched yet (grandfathering skipped when null)
export function computeMFGains(
  txns:        MFTransaction[],
  fundId:      string,
  assetClass:  'equity' | 'debt',
  fmvJan2018:  number | null,
  currentNav:  number | null,
  fyRange:     { start: string; end: string },
  asOf:        string,
): { realised: RealisedGain[]; unrealised: UnrealisedPosition[] } {
  const lots:     OpenLot[]      = []
  const realised: RealisedGain[] = []
  const classify  = assetClass === 'debt' ? classifyDebtMF : classifyByDays(LTCG_DAYS_EQUITY)

  for (const txn of sortTxns(txns)) {
    if (txn.trade_type === 'buy') {
      lots.push({
        purchaseDate: txn.trade_date,
        qty:          txn.units,
        costPerUnit:  txn.nav,
        fmvJan2018:   assetClass === 'equity' && txn.trade_date <= GRANDFATHER_DATE ? fmvJan2018 : null,
      })
    } else {
      realised.push(...fifoConsume(lots, txn.trade_date, txn.units, txn.nav, 'mf', fundId, fyRange, classify))
    }
  }

  const unrealised: UnrealisedPosition[] = lots.map(lot => {
    const holdingDays  = daysBetween(lot.purchaseDate, asOf)
    const gainType     = classify(lot, holdingDays)
    const currentValue = currentNav !== null ? lot.qty * currentNav : null
    const gain         = currentValue !== null ? currentValue - lot.qty * lot.costPerUnit : null
    return { assetType: 'mf' as AssetType, symbol: fundId, purchaseDate: lot.purchaseDate, qty: lot.qty, costPerUnit: lot.costPerUnit, purchaseCost: lot.qty * lot.costPerUnit, currentValue, gain, holdingDays, gainType }
  })

  return { realised, unrealised }
}

// ── Gold ─────────────────────────────────────────────────────────────────────

// symbol: caller-defined pool key (e.g. gold_type for ETF/physical, series name for SGB)
// ltcgDays: threshold for LTCG classification — defaults to gold's 3-year rule.
// Pass LTCG_DAYS_DEBT for ETF lots being folded into the tax page's debt
// bucket (24-month threshold, same rate mechanics as debt MF — but unlike
// debt MF, gold ETF has no purchase-date slab-only cutoff).
export function computeGoldGains(
  txns:                SGBTransaction[],
  symbol:              string,
  currentPricePerGram: number | null,
  fyRange:             { start: string; end: string },
  asOf:                string,
  ltcgDays:            number = LTCG_DAYS_GOLD,
): { realised: RealisedGain[]; unrealised: UnrealisedPosition[] } {
  const lots:     OpenLot[]      = []
  const realised: RealisedGain[] = []
  const classify  = classifyByDays(ltcgDays)

  for (const txn of sortTxns(txns)) {
    if (txn.trade_type === 'buy') {
      lots.push({ purchaseDate: txn.trade_date, qty: txn.grams, costPerUnit: txn.price_per_gram, fmvJan2018: null })
    } else {
      realised.push(...fifoConsume(lots, txn.trade_date, txn.grams, txn.price_per_gram, 'gold', symbol, fyRange, classify))
    }
  }

  const unrealised: UnrealisedPosition[] = lots.map(lot => {
    const holdingDays  = daysBetween(lot.purchaseDate, asOf)
    const gainType     = classify(lot, holdingDays)
    const currentValue = currentPricePerGram !== null ? lot.qty * currentPricePerGram : null
    const gain         = currentValue !== null ? currentValue - lot.qty * lot.costPerUnit : null
    return { assetType: 'gold' as AssetType, symbol, purchaseDate: lot.purchaseDate, qty: lot.qty, costPerUnit: lot.costPerUnit, purchaseCost: lot.qty * lot.costPerUnit, currentValue, gain, holdingDays, gainType }
  })

  return { realised, unrealised }
}

// ── Bucketed gains (equity/debt) ────────────────────────────────────────────
// Shared by the tax page, the advance-tax liability projection, and
// carryforward reconciliation — all three need the same realised-gains-split
// for a date range. Stock + equity MF go to `equity`; debt MF + gold ETF sold
// (not held to maturity) share `debt`, since post-Budget-2024 they carry the
// same rate mechanics (see lib/tax-liability.ts). SGB and physical gold have
// no resolved bucket in the 4-bucket model and are excluded entirely.

export interface GatherBucketedGainsInputs {
  stockMap: Map<string, Transaction[]>
  mfMap:    Map<string, MFTransaction[]>
  mfFunds:  MFund[]
  goldMap:  Map<string, SGBTransaction[]>   // keyed by gold_type: 'sgb' | 'etf' | 'physical'
  fyRange:  { start: string; end: string }
  asOf:     string
}

export function gatherBucketedGains(inputs: GatherBucketedGainsInputs): { equity: RealisedGain[]; debt: RealisedGain[] } {
  const { stockMap, mfMap, mfFunds, goldMap, fyRange, asOf } = inputs
  const equity: RealisedGain[] = []
  const debt:   RealisedGain[] = []

  for (const [symbol, txns] of stockMap) {
    equity.push(...computeStockGains(txns, symbol, null, fyRange, asOf).realised)
  }

  for (const [fundId, txns] of mfMap) {
    const fund     = mfFunds.find(f => f.id === fundId)
    const cls      = fund ? mfAssetClass(fund) : 'equity'
    const realised = computeMFGains(txns, fundId, cls, null, null, fyRange, asOf).realised
    if (cls === 'debt') debt.push(...realised)
    else                equity.push(...realised)
  }

  const etfTxns = goldMap.get('etf')
  if (etfTxns) {
    debt.push(...computeGoldGains(etfTxns, 'etf', null, fyRange, asOf, LTCG_DAYS_DEBT).realised)
  }

  return { equity, debt }
}
