import { getFiscalYears, getAllocations, getTransactions, getBuyBands, getInvestability, getBuyTranches, getUserId } from '@/lib/data'
import StockDetailClient from './StockDetailClient'
import BottomNav from '@/components/BottomNav'

export default async function StockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { symbol } = await params
  const { tab }    = await searchParams

  const fiscalYears = await getFiscalYears()
  const today = new Date()
  const fy = fiscalYears.find(f => new Date(f.start_date) <= today && today <= new Date(f.end_date)) ?? fiscalYears[0]

  const [allocations, transactions, bands, investability, allTranches] = fy
    ? await Promise.all([
        getAllocations(fy.id),
        getTransactions(fy.id),
        getBuyBands(),
        getInvestability(),
        getBuyTranches(fy.id),
      ])
    : [[], [], [], [], []]

  const allocation     = allocations.find(a => a.symbol === symbol) ?? null
  const band           = bands.find(b => b.symbol === symbol) ?? null
  const investability_ = investability.find(i => i.symbol === symbol) ?? null
  const stockTxns      = transactions.filter(t => t.symbol === symbol)
  const stockTranches  = allTranches.filter(t => t.symbol === symbol)

  return (
    <>
      <StockDetailClient
        symbol={symbol}
        fiscalYear={fy ?? null}
        allocation={allocation}
        transactions={stockTxns}
        allTransactions={transactions}
        band={band}
        tranches={stockTranches}
        investability={investability_}
        userId={await getUserId() ?? ''}
        initialTab={tab ?? 'overview'}
      />
      <BottomNav />
    </>
  )
}
