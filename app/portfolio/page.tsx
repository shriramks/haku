import { redirect } from 'next/navigation'
import { getUserId, getTransactions, getBuyBands, getFiscalYears, getAllocations, getMFFunds, getMFTransactions, getMFNavs, getStockPrices, getGoldPrice, getSGBTransactions, getPPFTransactions, getPPFOverride, getEPFTransactions } from '@/lib/data'
import { getCurrentFY } from '@/lib/fy-utils'
import { filterActiveMfFunds } from '@/lib/mf-compute'
import { heldSymbols } from '@/lib/stock-prices'
import { newestTimestamp, pricesAreStale } from '@/lib/price-freshness'
import type { StockAllocation } from '@/lib/types'
import PortfolioClient, { type StockTxn } from './PortfolioClient'
import BottomNav from '@/components/BottomNav'

export default async function PortfolioPage() {
  // getUserId is request-cached, so the getters below reuse this one auth read.
  const userId = await getUserId()
  if (!userId) redirect('/login')

  // Two fetch stages, not a chain. Stage 1: the cached getters (unstable_cache-wrapped in
  // lib/data.ts; see app/portfolio/actions.ts and TransactionsClient.tsx for the matching
  // revalidation on every write). Stage 2: the four uncached reads — none depends on another
  // (three need something from stage 1, the gold price needs nothing) — so they run in parallel.
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

  const held = heldSymbols(allTransactions)

  const [currentFYAllocations, mfNavInfo, stockPrices, goldPrice] = await Promise.all([
    currentFY ? getAllocations(currentFY.id) : Promise.resolve<StockAllocation[]>([]),
    getMFNavs(activeMfFunds.map(f => f.scheme_code)),
    getStockPrices(held),
    getGoldPrice(),
  ])

  // The client only computes open positions, and reads five transaction fields (StockTxn) —
  // so ship just those, for held symbols within the current FY's allocation list (every held
  // symbol when the FY has none). bandCmps is the band-snapshot fallback for resolveCmp.
  const heldSet = new Set(held)
  const inFY = new Set(currentFYAllocations.map(a => a.symbol))
  const inScope = (symbol: string) => heldSet.has(symbol) && (inFY.size === 0 || inFY.has(symbol))
  const stockTxns: StockTxn[] = allTransactions
    .filter(t => inScope(t.symbol))
    .map(({ symbol, trade_date, trade_type, quantity, amount }) => ({ symbol, trade_date, trade_type, quantity, amount }))
  const bandCmps: Record<string, number> = {}
  for (const b of bands) if (b.cmp !== null && inScope(b.symbol)) bandCmps[b.symbol] = b.cmp

  const mfNavs: Record<string, number> = {}
  const mfPrevNavs: Record<string, number | null> = {}
  const mfNavDates: Record<string, string> = {}
  for (const [code, info] of Object.entries(mfNavInfo)) {
    mfNavs[code] = info.nav
    mfPrevNavs[code] = info.prevNav
    mfNavDates[code] = info.navDate
  }

  // Drives the amber dot on the Prices button: the newest saved stock/gold price predates the last
  // market close. Only meaningful with something to price — an MF-only user has no stock/gold price
  // to go stale (their NAVs show per-row dates instead). Computed here, not in the client, so the
  // clock read never differs between server render and hydration.
  const hasPricedHoldings = held.length > 0 || sgbTransactions.length > 0
  const pricesStale = hasPricedHoldings && pricesAreStale(
    newestTimestamp([...Object.values(stockPrices).map(p => p.fetchedAt), goldPrice?.fetchedAt]),
    new Date(),
  )

  return (
    <>
      <PortfolioClient
        stockTxns={stockTxns}
        bandCmps={bandCmps}
        stockPrices={stockPrices}
        mfFunds={mfFunds}
        mfTransactions={mfTransactions}
        mfNavs={mfNavs}
        mfPrevNavs={mfPrevNavs}
        mfNavDates={mfNavDates}
        pricesStale={pricesStale}
        sgbTransactions={sgbTransactions}
        goldPrice={goldPrice?.cmp ?? null}
        prevGoldPrice={goldPrice?.prevClose ?? null}
        ppfTransactions={ppfTransactions}
        ppfOverride={ppfOverride}
        epfTransactions={epfTransactions}
      />
      <BottomNav />
    </>
  )
}
