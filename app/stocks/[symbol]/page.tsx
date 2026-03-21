import { getFiscalYears, getAllocations, getTransactions, getSymbolAllocations, getBuyBands, getInvestability, getUserId } from '@/lib/data'
import StockDetailClient from './StockDetailClient'
import BottomNav from '@/components/BottomNav'

export default async function StockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>
  searchParams: Promise<{ fy?: string }>
}) {
  const { symbol } = await params
  const { fy: fyParam } = await searchParams

  const fiscalYears = await getFiscalYears()
  const today = new Date()
  const fy = fyParam
    ? (fiscalYears.find(f => f.label === fyParam) ?? fiscalYears.find(f => new Date(f.start_date) <= today && today <= new Date(f.end_date)) ?? fiscalYears[0])
    : (fiscalYears.find(f => new Date(f.start_date) <= today && today <= new Date(f.end_date)) ?? fiscalYears[0])

  const [allocations, transactions, bands, investability, symbolAllocations, allTxns] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
        getBuyBands(),
        getInvestability(),
        getSymbolAllocations(symbol),
        getTransactions(),
      ])
    : [[], [], [], [], [], []]

  const allocation     = allocations.find(a => a.symbol === symbol) ?? null
  const band           = bands.find(b => b.symbol === symbol) ?? null
  const investability_ = investability.find(i => i.symbol === symbol) ?? null
  const stockTxns      = transactions.filter(t => t.symbol === symbol)
  const allSymbolTxns  = allTxns.filter(t => t.symbol === symbol)

  const allFYBudget = symbolAllocations.reduce((sum, alloc) => {
    const fyRow = fiscalYears.find(f => f.id === alloc.fy_id)
    return sum + (fyRow ? (alloc.allocation_pct / 100) * (fyRow.total_budget_inr + (fyRow.unallocated_carryover_inr ?? 0)) + (alloc.carryover_inr ?? 0) : 0)
  }, 0)

  return (
    <>
      <StockDetailClient
        symbol={symbol}
        fiscalYear={fy ?? null}
        allocation={allocation}
        transactions={stockTxns}
        allTransactions={allSymbolTxns}
        allFYBudget={allFYBudget}
        band={band}
        investability={investability_}
        userId={await getUserId() ?? ''}
      />
      <BottomNav />
    </>
  )
}
