import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTransactionsBySymbol, getStockPrices, getBuyBands } from '@/lib/data'
import { resolveCmp } from '@/lib/stock-prices'
import StockDetailClient from './StockDetailClient'
import BottomNav from '@/components/BottomNav'

export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>
}) {
  const { symbol } = await params

  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  const [transactions, stockPrices, bands] = await Promise.all([
    getTransactionsBySymbol(symbol),
    getStockPrices([symbol]),
    getBuyBands(),
  ])
  if (transactions.length === 0) redirect('/portfolio')

  // Same resolution as the Portfolio list, so the two screens can't show different prices.
  const cmp = resolveCmp(symbol, stockPrices, bands.find(b => b.symbol === symbol)?.cmp)

  return (
    <>
      <StockDetailClient
        symbol={symbol}
        transactions={transactions}
        cmp={cmp}
      />
      <BottomNav />
    </>
  )
}
