import type { Transaction } from './types'
import type { MFTransaction, SGBTransaction } from './portfolio-types'

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

const LTCG_DAYS_EQUITY = 365
const LTCG_DAYS_GOLD   = 1095
const GRANDFATHER_DATE = '2018-01-31'
const EPSILON          = 1e-6

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

function ltcgThreshold(assetType: AssetType): number {
  return assetType === 'gold' ? LTCG_DAYS_GOLD : LTCG_DAYS_EQUITY
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
): RealisedGain[] {
  const gains: RealisedGain[] = []
  const inFY = sellDate >= fyRange.start && sellDate <= fyRange.end
  let remaining = sellQty

  while (remaining > EPSILON && lots.length > 0) {
    const lot      = lots[0]
    const consumed = Math.min(lot.qty, remaining)

    const holdingDays = daysBetween(lot.purchaseDate, sellDate)
    const gainType    = holdingDays >= ltcgThreshold(assetType) ? 'LTCG' : 'STCG'
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

  for (const txn of sortTxns(txns)) {
    if (txn.trade_type === 'buy') {
      lots.push({ purchaseDate: txn.trade_date, qty: txn.quantity, costPerUnit: txn.price, fmvJan2018: null })
    } else {
      realised.push(...fifoConsume(lots, txn.trade_date, txn.quantity, txn.price, 'stock', symbol, fyRange))
    }
  }

  const unrealised: UnrealisedPosition[] = lots.map(lot => {
    const holdingDays  = daysBetween(lot.purchaseDate, asOf)
    const gainType     = holdingDays >= LTCG_DAYS_EQUITY ? 'LTCG' : 'STCG'
    const currentValue = cmp !== null ? lot.qty * cmp : null
    const gain         = currentValue !== null ? currentValue - lot.qty * lot.costPerUnit : null
    return { assetType: 'stock' as AssetType, symbol, purchaseDate: lot.purchaseDate, qty: lot.qty, costPerUnit: lot.costPerUnit, purchaseCost: lot.qty * lot.costPerUnit, currentValue, gain, holdingDays, gainType }
  })

  return { realised, unrealised }
}

// ── MF ───────────────────────────────────────────────────────────────────────

// fmvJan2018: NAV on Jan 31 2018 for this fund, null if fund had no pre-2018 units
// or if the value hasn't been fetched yet (grandfathering skipped when null)
export function computeMFGains(
  txns:        MFTransaction[],
  fundId:      string,
  fmvJan2018:  number | null,
  currentNav:  number | null,
  fyRange:     { start: string; end: string },
  asOf:        string,
): { realised: RealisedGain[]; unrealised: UnrealisedPosition[] } {
  const lots:     OpenLot[]      = []
  const realised: RealisedGain[] = []

  for (const txn of sortTxns(txns)) {
    if (txn.trade_type === 'buy') {
      lots.push({
        purchaseDate: txn.trade_date,
        qty:          txn.units,
        costPerUnit:  txn.nav,
        fmvJan2018:   txn.trade_date <= GRANDFATHER_DATE ? fmvJan2018 : null,
      })
    } else {
      realised.push(...fifoConsume(lots, txn.trade_date, txn.units, txn.nav, 'mf', fundId, fyRange))
    }
  }

  const unrealised: UnrealisedPosition[] = lots.map(lot => {
    const holdingDays  = daysBetween(lot.purchaseDate, asOf)
    const gainType     = holdingDays >= LTCG_DAYS_EQUITY ? 'LTCG' : 'STCG'
    const currentValue = currentNav !== null ? lot.qty * currentNav : null
    const gain         = currentValue !== null ? currentValue - lot.qty * lot.costPerUnit : null
    return { assetType: 'mf' as AssetType, symbol: fundId, purchaseDate: lot.purchaseDate, qty: lot.qty, costPerUnit: lot.costPerUnit, purchaseCost: lot.qty * lot.costPerUnit, currentValue, gain, holdingDays, gainType }
  })

  return { realised, unrealised }
}

// ── Gold ─────────────────────────────────────────────────────────────────────

// symbol: caller-defined pool key (e.g. gold_type for ETF/physical, series name for SGB)
export function computeGoldGains(
  txns:                SGBTransaction[],
  symbol:              string,
  currentPricePerGram: number | null,
  fyRange:             { start: string; end: string },
  asOf:                string,
): { realised: RealisedGain[]; unrealised: UnrealisedPosition[] } {
  const lots:     OpenLot[]      = []
  const realised: RealisedGain[] = []

  for (const txn of sortTxns(txns)) {
    if (txn.trade_type === 'buy') {
      lots.push({ purchaseDate: txn.trade_date, qty: txn.grams, costPerUnit: txn.price_per_gram, fmvJan2018: null })
    } else {
      realised.push(...fifoConsume(lots, txn.trade_date, txn.grams, txn.price_per_gram, 'gold', symbol, fyRange))
    }
  }

  const unrealised: UnrealisedPosition[] = lots.map(lot => {
    const holdingDays  = daysBetween(lot.purchaseDate, asOf)
    const gainType     = holdingDays >= LTCG_DAYS_GOLD ? 'LTCG' : 'STCG'
    const currentValue = currentPricePerGram !== null ? lot.qty * currentPricePerGram : null
    const gain         = currentValue !== null ? currentValue - lot.qty * lot.costPerUnit : null
    return { assetType: 'gold' as AssetType, symbol, purchaseDate: lot.purchaseDate, qty: lot.qty, costPerUnit: lot.costPerUnit, purchaseCost: lot.qty * lot.costPerUnit, currentValue, gain, holdingDays, gainType }
  })

  return { realised, unrealised }
}
