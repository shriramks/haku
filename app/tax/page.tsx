import { getFiscalYears, getCurrentFY, getTransactions, getAllDividends, getUserId, getMFFunds, getMFTransactions, getSGBTransactions } from '@/lib/data'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
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

  return (
    <>
      <TaxClient
        fiscalYears={fiscalYears}
        currentFY={currentFY}
        stockTxns={stockTxns}
        mfFunds={mfFunds}
        mfTxns={mfTxns}
        sgbTxns={sgbTxns}
        dividends={dividends}
        advanceTaxPaid={(advanceTaxPaid ?? []) as AdvanceTaxPaidRow[]}
        carryForward={(carryForward ?? []) as CarryForwardDbRow[]}
      />
      <BottomNav />
    </>
  )
}
