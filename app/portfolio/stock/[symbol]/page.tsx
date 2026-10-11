import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTransactionsBySymbol, getStockPrices, getBuyBands, getUsdInrRate } from '@/lib/data'
import { getStocks } from '@/lib/stock-master'
import { resolveCmp } from '@/lib/stock-prices'
import StockDetailClient from './StockDetailClient'

export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>
}) {
  const { symbol } = await params

  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  const [transactions, stockPrices, bands, stocks] = await Promise.all([
    getTransactionsBySymbol(symbol),
    getStockPrices([symbol]),
    getBuyBands(),
    getStocks([symbol]),
  ])
  if (transactions.length === 0) redirect('/portfolio')

  // The price is in the instrument's currency; a USD instrument is valued at today's USD->INR.
  const currency = stocks[symbol]?.currency ?? 'INR'
  const usdInr = currency === 'USD' ? await getUsdInrRate() : null

  // Same resolution as the Portfolio list, so the two screens can't show different prices.
  const cmp = resolveCmp(symbol, stockPrices, bands.find(b => b.symbol === symbol)?.cmp)

  return (
    <>
      <StockDetailClient
        symbol={symbol}
        transactions={transactions}
        cmp={cmp}
        currency={currency}
        inrRate={currency === 'INR' ? 1 : usdInr?.cmp ?? null}
      />
    </>
  )
}
