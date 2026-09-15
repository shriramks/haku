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

  // fiscalYears only gates the small getAllocations call below — fire it alongside
  // everything else instead of awaiting it first, so a cold fiscal_years cache
  // doesn't serialize in front of the other 8 independent queries.
  const [
    fiscalYears,
    allTransactions,
    bands,
    { data: mfFunds },
    { data: mfTransactions },
    { data: sgbTransactions },
    { data: ppfTransactions },
    { data: ppfOverrideRows },
    { data: epfTransactions },
  ] = await Promise.all([
    getFiscalYears(),
    getTransactions(),
    getBuyBands(),
    svc.from('mf_funds').select('id, scheme_code, scheme_name, scheme_type').eq('user_id', userId).order('scheme_name'),
    svc.from('mf_transactions').select('id, fund_id, trade_date, trade_type, units, nav, amount').eq('user_id', userId).order('trade_date', { ascending: true }).order('trade_type', { ascending: true }),
    svc.from('sgb_transactions').select('id, trade_date, trade_type, grams, price_per_gram, amount, maturity_date, gold_type, name').eq('user_id', userId).order('trade_date', { ascending: true }),
    svc.from('ppf_transactions').select('id, trade_date, trade_type, amount, notes').eq('user_id', userId).order('trade_date', { ascending: true }),
    svc.from('ppf_balance_override').select('id, balance, as_of_date').eq('user_id', userId).limit(1),
    svc.from('epf_transactions').select('id, trade_date, trade_type, amount, notes').eq('user_id', userId).order('trade_date', { ascending: true }),
  ])

  const currentFY           = getCurrentFY(fiscalYears)
  const currentFYAllocations = currentFY ? await getAllocations(currentFY.id) : []
  const latestYearSymbols   = currentFYAllocations.map(a => a.symbol)

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
