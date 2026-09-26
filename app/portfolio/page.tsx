import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTransactions, getBuyBands, getFiscalYears, getAllocations, getMFFunds, getMFTransactions, getMFNavHistory, getStockPrices, getSGBTransactions, getPPFTransactions, getPPFOverride, getEPFTransactions } from '@/lib/data'
import { getCurrentFY } from '@/lib/fy-utils'
import { filterActiveMfFunds } from '@/lib/mf-compute'
import { heldSymbols } from '@/lib/stock-prices'
import type { StockAllocation } from '@/lib/types'
import PortfolioClient from './PortfolioClient'
import BottomNav from '@/components/BottomNav'

export default async function PortfolioPage() {
  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  // Two fetch stages, not a chain. Stage 1: the cached getters (unstable_cache-wrapped in
  // lib/data.ts; see app/portfolio/actions.ts and TransactionsClient.tsx for the matching
  // revalidation on every write). Stage 2: the three uncached reads, which each need
  // something from stage 1 but not from each other, so they run in parallel.
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

  const currentFY = getCurrentFY(fiscalYears)

  // Only funds with a live unit balance need a NAV lookup — see filterActiveMfFunds.
  const activeMfFunds = filterActiveMfFunds(mfFunds, mfTransactions)

  const [currentFYAllocations, mfNavHistory, stockPrices] = await Promise.all([
    currentFY ? getAllocations(currentFY.id) : Promise.resolve<StockAllocation[]>([]),
    getMFNavHistory(activeMfFunds.map(f => f.scheme_code)),
    getStockPrices(heldSymbols(allTransactions)),
  ])
  const latestYearSymbols = currentFYAllocations.map(a => a.symbol)

  const mfNavs: Record<string, number> = {}
  const mfPrevNavs: Record<string, number | null> = {}
  for (const [code, info] of Object.entries(mfNavHistory)) {
    mfNavs[code] = info.nav
    mfPrevNavs[code] = info.prevNav
  }

  return (
    <>
      <PortfolioClient
        allTransactions={allTransactions}
        bands={bands}
        latestYearSymbols={latestYearSymbols}
        stockPrices={stockPrices}
        mfFunds={mfFunds}
        mfTransactions={mfTransactions}
        mfNavs={mfNavs}
        mfPrevNavs={mfPrevNavs}
        sgbTransactions={sgbTransactions}
        ppfTransactions={ppfTransactions}
        ppfOverride={ppfOverride}
        epfTransactions={epfTransactions}
      />
      <BottomNav />
    </>
  )
}
