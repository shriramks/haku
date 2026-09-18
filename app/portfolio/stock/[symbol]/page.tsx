import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTransactionsBySymbol } from '@/lib/data'
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

  const transactions = await getTransactionsBySymbol(symbol)
  if (transactions.length === 0) redirect('/portfolio')

  return (
    <>
      <StockDetailClient
        symbol={symbol}
        transactions={transactions}
      />
      <BottomNav />
    </>
  )
}
