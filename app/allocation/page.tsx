import { getFiscalYears, getPlanAllocations, getTransactions, getBuyBands, getCurrentFY, getStockPrices, getInrPerUnit, getFYPPFDeposits, getFYFundInvested, getFYGoldInvested, getFundIdsByScheme } from '@/lib/data'
import { computeAllTimeHoldings } from '@/lib/compute'
import { heldSymbols } from '@/lib/stock-prices'
import DashboardClient from './DashboardClient'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  // getTransactions()/getBuyBands() don't depend on the current FY — fire them
  // alongside getFiscalYears() instead of behind it, so a cold fiscal_years cache
  // doesn't serialize in front of two otherwise-independent queries.
  const [fiscalYears, { fy: fyParam }, allTransactions, bands] = await Promise.all([
    getFiscalYears(),
    searchParams,
    getTransactions(),
    getBuyBands(),
  ])

  const currentFY = getCurrentFY(fiscalYears, fyParam)

  const [allocations, transactions, ppfInvested, fundInvested, goldInvested] = currentFY
    ? await Promise.all([
        getPlanAllocations(currentFY.id),
        getTransactions(currentFY.id),
        getFYPPFDeposits(currentFY.id),
        getFYFundInvested(currentFY.id),
        getFYGoldInvested(currentFY.id),
      ])
    : [[], [], 0, {}, {}]
  const fundIds = await getFundIdsByScheme()

  // Per-symbol all-time aggregates only — the full history stays server-side
  const allTimeHoldings = computeAllTimeHoldings(allTransactions)

  // Saved prices (resolveCmp) for every symbol the page can show across FY switches: held + banded.
  const priceSymbols = [...new Set([...heldSymbols(allTransactions), ...bands.map(b => b.symbol)])]
  const [prices, inrRates] = await Promise.all([getStockPrices(priceSymbols), getInrPerUnit(priceSymbols)])

  return (
    <>
      <DashboardClient
        fiscalYears={fiscalYears}
        initialFY={currentFY ?? null}
        initialAllocations={allocations}
        initialTransactions={transactions}
        initialPPFInvested={ppfInvested}
        initialFundInvested={fundInvested}
        initialGoldInvested={goldInvested}
        fundIds={fundIds}
        allTimeHoldings={allTimeHoldings}
        bands={bands}
        prices={prices}
        inrRates={inrRates}
      />
    </>
  )
}
