import { getTransactions, getFiscalYears, getCurrentFY, getUserId } from '@/lib/data'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import TransactionsClient from './TransactionsClient'
import BottomNav from '@/components/BottomNav'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, EPFTransaction } from '@/lib/portfolio-types'

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>
}) {
  const { symbol } = await searchParams
  const userId = await getUserId()
  const svc    = createSupabaseServiceClient()

  const empty = Promise.resolve({ data: [] as never[] })

  const [
    fiscalYears,
    transactions,
    { data: mfFunds },
    { data: mfTransactions },
    { data: sgbTransactions },
    { data: ppfTransactions },
    { data: epfTransactions },
  ] = await Promise.all([
    getFiscalYears(),
    getTransactions(),
    userId ? svc.from('mf_funds').select('*').eq('user_id', userId).order('scheme_name') : empty,
    userId ? svc.from('mf_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: false }) : empty,
    userId ? svc.from('sgb_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: false }) : empty,
    userId ? svc.from('ppf_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: false }) : empty,
    userId ? svc.from('epf_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: false }) : empty,
  ])

  const currentFY = getCurrentFY(fiscalYears) ?? null

  return (
    <>
      <TransactionsClient
        transactions={transactions}
        fiscalYears={fiscalYears}
        currentFY={currentFY}
        filterSymbol={symbol?.toUpperCase()}
        mfFunds={(mfFunds ?? []) as MFund[]}
        mfTransactions={(mfTransactions ?? []) as MFTransaction[]}
        sgbTransactions={(sgbTransactions ?? []) as SGBTransaction[]}
        ppfTransactions={(ppfTransactions ?? []) as PPFTransaction[]}
        epfTransactions={(epfTransactions ?? []) as EPFTransaction[]}
      />
      <BottomNav />
    </>
  )
}
