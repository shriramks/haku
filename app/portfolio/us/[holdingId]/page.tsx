import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUsHoldings, getUsTransactions, getStockPrices, getUsdInrRate } from '@/lib/data'
import { usPriceKey } from '@/lib/stock-prices'
import UsHoldingDetailClient from './UsHoldingDetailClient'

export default async function UsHoldingDetailPage({
  params,
}: {
  params: Promise<{ holdingId: string }>
}) {
  const { holdingId } = await params

  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  const [usHoldings, usTransactions] = await Promise.all([getUsHoldings(), getUsTransactions()])

  const holding = usHoldings.find(h => h.id === holdingId)
  if (!holding) redirect('/portfolio')
  const transactions = usTransactions.filter(t => t.holding_id === holdingId)

  const key = usPriceKey(holding.yahoo_symbol)
  const [prices, usdInr] = await Promise.all([getStockPrices([key]), getUsdInrRate()])
  const quote = prices[key] ?? null

  return (
    <UsHoldingDetailClient
      holding={holding}
      transactions={transactions}
      quote={quote}
      fx={usdInr ? { rate: usdInr.cmp, prevRate: usdInr.prevClose } : null}
      fxDate={usdInr?.fetchedAt ?? null}
    />
  )
}
