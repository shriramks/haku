import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { getTransactions, getBuyBands, getFiscalYears, getAllocations, getMFFunds, getMFTransactions } from '@/lib/data'
import { getCurrentFY } from '@/lib/fy-utils'
import PortfolioClient from './PortfolioClient'
import BottomNav from '@/components/BottomNav'
import type { SGBTransaction, PPFTransaction, PPFBalanceOverride, EPFTransaction } from '@/lib/portfolio-types'

export default async function PortfolioPage() {
  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  const userId = session.user.id
  const svc    = createSupabaseServiceClient()

  // fiscalYears only gates the small getAllocations call below — fire it alongside
  // everything else instead of awaiting it first, so a cold fiscal_years cache
  // doesn't serialize in front of the other 8 independent queries.
  // mfFunds/mfTransactions go through lib/data.ts's unstable_cache-wrapped getters —
  // the only two of these tables cached today; see app/portfolio/actions.ts and
  // TransactionsClient.tsx for the matching revalidation on every write.
  const [
    fiscalYears,
    allTransactions,
    bands,
    mfFunds,
    mfTransactions,
    { data: sgbTransactions },
    { data: ppfTransactions },
    { data: ppfOverrideRows },
    { data: epfTransactions },
  ] = await Promise.all([
    getFiscalYears(),
    getTransactions(),
    getBuyBands(),
    getMFFunds(),
    getMFTransactions(),
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
        mfFunds={mfFunds}
        mfTransactions={mfTransactions}
        sgbTransactions={(sgbTransactions ?? []) as SGBTransaction[]}
        ppfTransactions={(ppfTransactions ?? []) as PPFTransaction[]}
        ppfOverride={((ppfOverrideRows ?? [])[0] ?? null) as PPFBalanceOverride | null}
        epfTransactions={(epfTransactions ?? []) as EPFTransaction[]}
      />
      <BottomNav />
    </>
  )
}
