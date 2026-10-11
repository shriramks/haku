// Bands "Refresh CMP" (#151): fetch latest NSE prices for symbols the caller owns and save
// them to stock_prices, so Bands and Portfolio read one price. Like the Portfolio refresh route,
// the price always comes from Yahoo server-side — the client only names symbols, never supplies a
// price, so nothing client-supplied reaches a table every user reads.
import { createSupabaseServiceClient } from './supabase-service'
import { getStockPrices, getUserId } from './data'
import { fetchCmpBatch, type CmpQuoteBatch } from './market-data'
import { buildPriceUpdate } from './stock-prices'

export type RefreshedStockPrices = Pick<CmpQuoteBatch, 'prices' | 'week52'>

/** Returns null when unauthenticated or on a save failure; symbols the caller has no transaction, band or plan row for are ignored. */
export async function refreshStockPrices(symbols: string[]): Promise<RefreshedStockPrices | null> {
  const userId = await getUserId()
  if (!userId) return null
  const requested = [...new Set(symbols.map(s => s.trim()).filter(Boolean))]
  if (requested.length === 0) return { prices: {}, week52: {} }

  const service = createSupabaseServiceClient()
  const ownedIn = (table: 'transactions' | 'buy_bands' | 'stock_allocations') =>
    service.from(table).select('symbol').eq('user_id', userId).in('symbol', requested)
  const results = await Promise.all([ownedIn('transactions'), ownedIn('buy_bands'), ownedIn('stock_allocations')])
  if (results.some(r => r.error)) return null
  const owned = new Set(results.flatMap(r => (r.data ?? []).map(row => row.symbol as string)))
  const allowed = requested.filter(s => owned.has(s))
  if (allowed.length === 0) return { prices: {}, week52: {} }

  const [previous, batch] = await Promise.all([getStockPrices(allowed), fetchCmpBatch(allowed)])
  const { rows } = buildPriceUpdate(allowed, batch, previous, new Date().toISOString())
  if (rows.length > 0) {
    const { error } = await service.from('stock_prices').upsert(rows, { onConflict: 'symbol' })
    if (error) return null
  }
  return { prices: batch.prices, week52: batch.week52 }
}
