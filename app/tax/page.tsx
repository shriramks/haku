import { getFiscalYears, getCurrentFY, getTransactions, getAllDividends, getUserId, getMFFunds, getMFTransactions, getMFNavHistory, getSGBTransactions } from '@/lib/data'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { mfAssetClass } from '@/lib/tax-compute'
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
    mfFunds,
    mfTxns,
    sgbTxns,
    dividends,
    { data: advanceTaxPaid },
    { data: carryForward },
  ] = await Promise.all([
    getFiscalYears(),
    getTransactions(),
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
  const mfNavHistory = await getMFNavHistory(equityFunds.map(f => f.scheme_code))
  const mfNavs: Record<string, number> = {}
  for (const [code, info] of Object.entries(mfNavHistory)) mfNavs[code] = info.nav

  return (
    <>
      <TaxClient
        fiscalYears={fiscalYears}
        currentFY={currentFY}
        stockTxns={stockTxns}
        mfFunds={mfFunds}
        mfTxns={mfTxns}
        mfNavs={mfNavs}
        sgbTxns={sgbTxns}
        dividends={dividends}
        advanceTaxPaid={(advanceTaxPaid ?? []) as AdvanceTaxPaidRow[]}
        carryForward={(carryForward ?? []) as CarryForwardDbRow[]}
      />
      <BottomNav />
    </>
  )
}
