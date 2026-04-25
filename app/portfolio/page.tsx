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

  const [
    allTransactions,
    bands,
    fiscalYears,
    { data: mfFunds },
    { data: mfTransactions },
    { data: sgbTransactions },
    { data: ppfTransactions },
    { data: ppfOverrideRows },
    { data: epfTransactions },
  ] = await Promise.all([
    getTransactions(),
    getBuyBands(),
    getFiscalYears(),
    svc.from('mf_funds').select('*').eq('user_id', userId).order('scheme_name'),
    svc.from('mf_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: true }).order('trade_type', { ascending: true }),
    svc.from('sgb_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: true }),
    svc.from('ppf_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: true }),
    svc.from('ppf_balance_override').select('*').eq('user_id', userId).limit(1),
    svc.from('epf_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: true }),
  ])

  const currentFY = getCurrentFY(fiscalYears)
  const currentFYAllocations = currentFY ? await getAllocations(currentFY.id) : []
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
