import { getFiscalYears, getCurrentFY, getTransactions, getBuyBands, getAllDividends, getUserId, getMFFunds, getMFTransactions, getMFNavs, getStockPrices, getSGBTransactions } from '@/lib/data'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { mfAssetClass, groupBy, netStockQty } from '@/lib/tax-compute'
import { resolveCmp } from '@/lib/stock-prices'
import type { AdvanceTaxPaidRow, CarryForwardDbRow } from '@/lib/types'
import TaxClient from './TaxClient'
import BottomNav from '@/components/BottomNav'

export default async function TaxPage() {
  const userId = await getUserId()
  const svc    = createSupabaseServiceClient()

  const empty = Promise.resolve({ data: [] as never[] })

  const [
    fiscalYears,
    stockTxns,
    bands,
    mfFunds,
    mfTxns,
    sgbTxns,
    dividends,
    { data: advanceTaxPaid },
    { data: carryForward },
  ] = await Promise.all([
    getFiscalYears(),
    getTransactions(),
    getBuyBands(),
    getMFFunds(),
    getMFTransactions(),
    getSGBTransactions(),
    getAllDividends(),
    userId ? svc.from('advance_tax_paid').select('id, fy_id, jun, sep, dec, mar').eq('user_id', userId) : empty,
    userId ? svc.from('capital_loss_carryforward').select('id, fy_id, loss_type, remaining').eq('user_id', userId) : empty,
  ])

  const currentFY = getCurrentFY(fiscalYears) ?? null

  // Harvesting's unrealised-loss figure needs the current NAV for equity funds
  // only (no 1D gain shown on this screen, so no prevNav).
  const equityFunds = mfFunds.filter(f => mfAssetClass(f) === 'equity')

  // Stocks are priced the way Portfolio prices them (resolveCmp: saved stock_prices
  // row, else the band snapshot) — only symbols with an open position, since those
  // are the only ones Harvesting computes unrealised gains for.
  const openSymbols = [...groupBy(stockTxns, t => t.symbol)]
    .filter(([, txns]) => netStockQty(txns) > 0)
    .map(([symbol]) => symbol)

  const [mfNavInfo, stockPrices] = await Promise.all([
    getMFNavs(equityFunds.map(f => f.scheme_code)),
    getStockPrices(openSymbols),
  ])
  const mfNavs: Record<string, number> = {}
  for (const [code, info] of Object.entries(mfNavInfo)) mfNavs[code] = info.nav

  const bandCmp = new Map(bands.map(b => [b.symbol, b.cmp]))
  const cmps: Record<string, number> = {}
  for (const symbol of openSymbols) {
    const cmp = resolveCmp(symbol, stockPrices, bandCmp.get(symbol))
    if (cmp !== null) cmps[symbol] = cmp
  }

  return (
    <>
      <TaxClient
        fiscalYears={fiscalYears}
        currentFY={currentFY}
        stockTxns={stockTxns}
        mfFunds={mfFunds}
        mfTxns={mfTxns}
        mfNavs={mfNavs}
        cmps={cmps}
        sgbTxns={sgbTxns}
        dividends={dividends}
        advanceTaxPaid={(advanceTaxPaid ?? []) as AdvanceTaxPaidRow[]}
        carryForward={(carryForward ?? []) as CarryForwardDbRow[]}
      />
      <BottomNav />
    </>
  )
}
