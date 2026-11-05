import { deriveIndexEps, getIndexFeed, getIndexSource } from '@/lib/band-calculator'
import type { BandResult } from '@/lib/band-calculator'
import { fetchNseIndex } from '@/lib/nse'
import { fetchCmp } from '@/lib/market-data'
import { fetchSp500Pe } from '@/lib/multpl'
import { ensureStocks } from '@/lib/stock-master'
import type { StockCategory } from '@/lib/types'

export interface IndexInputs { level: number | null; pe: number; cmp: number; eps: number }

/** The stored `buy_bands` columns the generate route reads back. */
export interface StoredBand {
  eps: number | null
  pat_now: number | null
  pat_3yr_ago: number | null
  roce_3yr_avg: number | null
  mcap: number | null
  index_level: number | null
  index_pe: number | null
  cmp: number | null
  notes: string | null
  generated_at: string | null
}

export interface IndexState {
  indexLevel: number | null
  indexPE: number | null
  indexCmp: number | null
  indexEps: number | null
}

// Fetch a fresh, consistent (CMP, PE) pair for an index ETF and derive eps = cmp/pe.
// The PE feed comes from the category: NSE (keyed on the index name, which also gives the index
// level) or multpl (S&P 500, PE only). fetchCmp takes the ETF's Yahoo symbol from the instrument
// master. Both read in one moment so the stored band, eps, and cmp stay mutually
// consistent — that consistency is what makes the rupee-band zone test reduce exactly to a PE comparison.
export async function fetchIndexInputs(category: StockCategory, symbol: string): Promise<IndexInputs> {
  const feed = getIndexFeed(category)
  if (!feed) throw new Error(`No PE source for category "${category}"`)
  const instrument = (await ensureStocks([symbol]))?.[symbol]
  if (!instrument) throw new Error(`No instrument master row for ${symbol}`)

  let level: number | null = null
  let pe: number
  let cmp: number | null
  if (feed === 'multpl') {
    ;[pe, cmp] = await Promise.all([fetchSp500Pe(), fetchCmp(instrument.yahooSymbol)])
  } else {
    const indexName = getIndexSource(category)
    if (!indexName) throw new Error(`No NSE index mapping for category "${category}"`)
    const [idx, price] = await Promise.all([fetchNseIndex(indexName), fetchCmp(instrument.yahooSymbol)])
    level = idx.level; pe = idx.pe; cmp = price
  }
  if (cmp == null) throw new Error(`No CMP available for ${symbol}`)
  const eps = deriveIndexEps(cmp, pe)
  if (eps == null) throw new Error(`Cannot derive index eps for ${symbol} (cmp=${cmp}, pe=${pe})`)
  return { level, pe, cmp, eps }
}

/**
 * Index (CMP, PE, eps) for a bands run: the stored values, or a fresh consistent pair when
 * `refetch`. The stored cmp must equal the cmp baked into eps, else the rupee-band zone test
 * no longer reduces exactly to a PE comparison. Throws if the fresh fetch fails.
 */
export async function resolveIndexState(
  category: StockCategory,
  symbol: string,
  existing: Pick<StoredBand, 'index_level' | 'index_pe' | 'cmp'> | null,
  refetch: boolean,
): Promise<IndexState> {
  const stored: IndexState = {
    indexLevel: existing?.index_level ?? null,
    indexPE: existing?.index_pe ?? null,
    indexCmp: existing?.cmp ?? null,
    indexEps: deriveIndexEps(existing?.cmp ?? null, existing?.index_pe ?? null),
  }
  if (!refetch) return stored
  const idx = await fetchIndexInputs(category, symbol)
  return { indexLevel: idx.level, indexPE: idx.pe, indexCmp: idx.cmp, indexEps: idx.eps }
}

export interface FinancialsRow {
  eps: number
  asOf: string
  patNow: number | null
  pat3yrAgo: number | null
  roce3yrAvg: number | null
  mcap: number | null
  opProfitCr: number | null
  revenueCr: number | null
}

/** `buy_bands` upsert payload for the `financials` action. Band prices are left untouched. */
export function buildFinancialsPayload(
  userId: string,
  symbol: string,
  f: FinancialsRow,
  existing: Pick<StoredBand, 'cmp' | 'generated_at'> | null,
  now: string,
): Record<string, unknown> {
  return {
    user_id: userId,
    symbol,
    anchor_type: 'PE',
    eps: f.eps,
    cmp: existing?.cmp ?? null,
    notes: f.asOf,
    last_updated_at: now,
    generated_at: existing?.generated_at ?? now,
    pat_now: f.patNow,
    pat_3yr_ago: f.pat3yrAgo,
    roce_3yr_avg: f.roce3yrAvg,
    mcap: f.mcap,
    op_profit_cr: f.opProfitCr,
    revenue_cr: f.revenueCr,
  }
}

/** `buy_bands` upsert payload for the `bands` action. */
export function buildBandsPayload(args: {
  userId: string
  symbol: string
  isIndex: boolean
  eps: number
  stored: Pick<StoredBand, 'pat_now' | 'pat_3yr_ago' | 'roce_3yr_avg' | 'mcap' | 'cmp' | 'notes'>
  index: IndexState
  result: BandResult
  now: string
}): Record<string, unknown> {
  const { userId, symbol, isIndex, eps, stored, index, result, now } = args
  return {
    user_id: userId,
    symbol,
    anchor_type: 'PE',
    eps,
    pat_now: stored.pat_now,
    pat_3yr_ago: stored.pat_3yr_ago,
    roce_3yr_avg: stored.roce_3yr_avg,
    mcap: stored.mcap,
    index_level: index.indexLevel,
    index_pe: index.indexPE,
    buy_low: result.buyLow,
    buy_high: result.buyHigh,
    mid_low: result.midLow,
    mid_high: result.midHigh,
    trim_price: result.trimPrice,
    cmp: isIndex ? index.indexCmp : stored.cmp,
    notes: stored.notes ?? '',
    last_updated_at: now,
    generated_at: now,
  }
}

export type FinancialsEdit =
  | { kind: 'index'; cmp: number | null; indexPe: number | null }
  | { kind: 'equity'; eps: number | null; patNow: number | null; pat3yrAgo: number | null; opProfitCr: number | null; revenueCr: number | null; roce3yrAvg: number | null; mcap: number | null }

/**
 * `buy_bands` columns written when the user saves the Financials sheet. Index rows persist the
 * edited (CMP, PE) pair plus the derived eps; band prices are then recomputed from these stored
 * values (no fetch), so the manual correction holds until the next fresh Regen Bands.
 */
export function buildFinancialsEditFields(edit: FinancialsEdit, now: string): Record<string, unknown> {
  if (edit.kind === 'index') {
    return { eps: deriveIndexEps(edit.cmp, edit.indexPe), index_pe: edit.indexPe, cmp: edit.cmp, last_updated_at: now }
  }
  return {
    eps: edit.eps,
    pat_now: edit.patNow,
    pat_3yr_ago: edit.pat3yrAgo,
    op_profit_cr: edit.opProfitCr,
    revenue_cr: edit.revenueCr,
    roce_3yr_avg: edit.roce3yrAvg,
    mcap: edit.mcap,
    last_updated_at: now,
  }
}
