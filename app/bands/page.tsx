import { getFiscalYears, getAllocations, getTransactions, getBuyBands, getCurrentFY, getInvestability, getStockPrices, getInrPerUnit } from '@/lib/data'
import { computeStockRows } from '@/lib/compute'
import { getStocks } from '@/lib/stock-master'
import BandsClient from './BandsClient'

export default async function BandsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>
}) {
  // getBuyBands() doesn't depend on the current FY — fire it alongside
  // getFiscalYears() instead of behind it, mirroring the allocation page fix.
  const [fiscalYears, { fy: fyParam }, bands] = await Promise.all([
    getFiscalYears(),
    searchParams,
    getBuyBands(),
  ])
  const fy = getCurrentFY(fiscalYears, fyParam) ?? fiscalYears[fiscalYears.length - 1]

  const [allocations, transactions] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
      ])
    : [[], []]

  const symbols = allocations.map((a: { symbol: string }) => a.symbol)
  const [investabilities, prices, inrRates] = await Promise.all([getInvestability(symbols), getStockPrices(symbols), getInrPerUnit(symbols)])

  const currencies = Object.fromEntries(Object.values(await getStocks(symbols)).map(s => [s.symbol, s.currency]))
  const rows = computeStockRows(allocations, transactions, bands, (fy?.total_budget_inr ?? 0) + (fy?.unallocated_carryover_inr ?? 0), undefined, prices, inrRates)
  const sorted = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol))

  return (
    <>
      <BandsClient
        rows={sorted}
        bands={bands}
        fyId={fy?.id ?? ''}
        fiscalYears={fiscalYears}
        selectedFY={fy ?? null}
        investabilities={investabilities}
        currencies={currencies}
      />
    </>
  )
}
