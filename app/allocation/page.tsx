import { getFiscalYears, getPlanAllocations, getTransactions, getBuyBands, getCurrentFY, getStockPrices, getInrPerUnit } from '@/lib/data'
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

  const [allocations, transactions] = currentFY
    ? await Promise.all([
        getPlanAllocations(currentFY.id),
        getTransactions(currentFY.id),
      ])
    : [[], []]

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
        allTimeHoldings={allTimeHoldings}
        bands={bands}
        prices={prices}
        inrRates={inrRates}
      />
    </>
  )
}
