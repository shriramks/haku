import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTransactions, getBuyBands, getFiscalYears, getAllocations, getMFFunds, getMFTransactions, getSGBTransactions, getPPFTransactions, getPPFOverride, getEPFTransactions } from '@/lib/data'
import { getCurrentFY } from '@/lib/fy-utils'
import PortfolioClient from './PortfolioClient'
import BottomNav from '@/components/BottomNav'

export default async function PortfolioPage() {
  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  // fiscalYears only gates the small getAllocations call below — fire it alongside
  // everything else instead of awaiting it first, so a cold fiscal_years cache
  // doesn't serialize in front of the other independent queries. Every table here
  // goes through lib/data.ts's unstable_cache-wrapped getters; see app/portfolio/actions.ts
  // and TransactionsClient.tsx for the matching revalidation on every write.
  const [
    fiscalYears,
    allTransactions,
    bands,
    mfFunds,
    mfTransactions,
    sgbTransactions,
    ppfTransactions,
    ppfOverride,
    epfTransactions,
  ] = await Promise.all([
    getFiscalYears(),
    getTransactions(),
    getBuyBands(),
    getMFFunds(),
    getMFTransactions(),
    getSGBTransactions(),
    getPPFTransactions(),
    getPPFOverride(),
    getEPFTransactions(),
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
        sgbTransactions={sgbTransactions}
        ppfTransactions={ppfTransactions}
        ppfOverride={ppfOverride}
        epfTransactions={epfTransactions}
      />
      <BottomNav />
    </>
  )
}
