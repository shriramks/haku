import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTransactions, getFiscalYears } from '@/lib/data'
import TransactionsClient from './TransactionsClient'
import BottomNav from '@/components/BottomNav'

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { symbol } = await searchParams
  const [transactions, fiscalYears] = await Promise.all([getTransactions(), getFiscalYears()])

  return (
    <>
      <TransactionsClient
        transactions={transactions}
        fiscalYears={fiscalYears}
        filterSymbol={symbol?.toUpperCase()}
      />
      <BottomNav />
    </>
  )
}
