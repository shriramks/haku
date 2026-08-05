import { getFiscalYears, getCurrentFY, getTransactions, getAllDividends, getUserId } from '@/lib/data'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import type { MFund, MFTransaction, SGBTransaction } from '@/lib/portfolio-types'
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
    { data: mfFunds },
    { data: mfTxns },
    { data: sgbTxns },
    dividends,
    { data: advanceTaxPaid },
    { data: carryForward },
  ] = await Promise.all([
    getFiscalYears(),
    getTransactions(),
    userId ? svc.from('mf_funds').select('id, scheme_code, scheme_name, scheme_type').eq('user_id', userId).order('scheme_name') : empty,
    userId ? svc.from('mf_transactions').select('id, fund_id, trade_date, trade_type, units, nav, amount').eq('user_id', userId).order('trade_date', { ascending: true }) : empty,
    userId ? svc.from('sgb_transactions').select('id, trade_date, trade_type, grams, price_per_gram, amount, maturity_date, gold_type, name').eq('user_id', userId).order('trade_date', { ascending: true }) : empty,
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
        mfFunds={(mfFunds ?? []) as MFund[]}
        mfTxns={(mfTxns ?? []) as MFTransaction[]}
        sgbTxns={(sgbTxns ?? []) as SGBTransaction[]}
        dividends={dividends}
        advanceTaxPaid={(advanceTaxPaid ?? []) as AdvanceTaxPaidRow[]}
        carryForward={(carryForward ?? []) as CarryForwardDbRow[]}
      />
      <BottomNav />
    </>
  )
}
