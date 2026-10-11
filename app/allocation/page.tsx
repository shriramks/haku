import { getFiscalYears, getPlanAllocations, getTransactions, getBuyBands, getCurrentFY, getUsFYTransactions, getUsHoldings, getStockPrices } from '@/lib/data'
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
  const [fiscalYears, { fy: fyParam }, allTransactions, bands, usHoldings] = await Promise.all([
    getFiscalYears(),
    searchParams,
    getTransactions(),
    getBuyBands(),
    getUsHoldings(),
  ])

  const currentFY = getCurrentFY(fiscalYears, fyParam)

  const [allocations, transactions] = currentFY
    ? await Promise.all([
        getPlanAllocations(currentFY.id),
        Promise.all([getTransactions(currentFY.id), getUsFYTransactions(currentFY)]).then(([s, us]) => [...s, ...us]),
      ])
    : [[], []]

  // Per-symbol all-time aggregates only — the full history stays server-side
  const allTimeHoldings = computeAllTimeHoldings(allTransactions)

  // Saved prices (resolveCmp) for every symbol the page can show across FY switches: held + banded.
  const prices = await getStockPrices([...new Set([...heldSymbols(allTransactions), ...bands.map(b => b.symbol)])])

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
        usHoldingIds={Object.fromEntries(usHoldings.map(h => [h.symbol, h.id]))}
      />
    </>
  )
}
