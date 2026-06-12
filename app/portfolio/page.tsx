import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { getTransactions, getBuyBands, getFiscalYears, getAllocations } from '@/lib/data'
import { getCurrentFY } from '@/lib/fy-utils'
import PortfolioClient from './PortfolioClient'
import BottomNav from '@/components/BottomNav'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, PPFBalanceOverride, EPFTransaction } from '@/lib/portfolio-types'

export default async function PortfolioPage() {
  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  const userId = session.user.id
  const svc    = createSupabaseServiceClient()

  const fiscalYears = await getFiscalYears()
  const currentFY   = getCurrentFY(fiscalYears)

  const [
    allTransactions,
    bands,
    currentFYAllocations,
    { data: mfFunds },
    { data: mfTransactions },
    { data: sgbTransactions },
    { data: ppfTransactions },
    { data: ppfOverrideRows },
    { data: epfTransactions },
  ] = await Promise.all([
    getTransactions(),
    getBuyBands(),
    currentFY ? getAllocations(currentFY.id) : Promise.resolve([]),
    svc.from('mf_funds').select('id, scheme_code, scheme_name, scheme_type').eq('user_id', userId).order('scheme_name'),
    svc.from('mf_transactions').select('id, fund_id, trade_date, trade_type, units, nav, amount').eq('user_id', userId).order('trade_date', { ascending: true }).order('trade_type', { ascending: true }),
    svc.from('sgb_transactions').select('id, trade_date, trade_type, grams, price_per_gram, amount, maturity_date, gold_type, name').eq('user_id', userId).order('trade_date', { ascending: true }),
    svc.from('ppf_transactions').select('id, trade_date, trade_type, amount, notes').eq('user_id', userId).order('trade_date', { ascending: true }),
    svc.from('ppf_balance_override').select('id, balance, as_of_date').eq('user_id', userId).limit(1),
    svc.from('epf_transactions').select('id, trade_date, trade_type, amount, notes').eq('user_id', userId).order('trade_date', { ascending: true }),
  ])

  const latestYearSymbols = currentFYAllocations.map(a => a.symbol)

  return (
    <>
      <PortfolioClient
        allTransactions={allTransactions}
        bands={bands}
        latestYearSymbols={latestYearSymbols}
        mfFunds={(mfFunds ?? []) as MFund[]}
        mfTransactions={(mfTransactions ?? []) as MFTransaction[]}
        sgbTransactions={(sgbTransactions ?? []) as SGBTransaction[]}
        ppfTransactions={(ppfTransactions ?? []) as PPFTransaction[]}
        ppfOverride={((ppfOverrideRows ?? [])[0] ?? null) as PPFBalanceOverride | null}
        epfTransactions={(epfTransactions ?? []) as EPFTransaction[]}
      />
      <BottomNav />
    </>
  )
}
