import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTransactions, getFiscalYears } from '@/lib/data'
import TransactionsClient from './TransactionsClient'
import BottomNav from '@/components/BottomNav'

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; fy?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { symbol, fy: fyParam } = await searchParams
  const fiscalYears = await getFiscalYears()

  const today = new Date()
  const selectedFY = fyParam
    ? (fiscalYears.find(f => f.label === fyParam) ?? fiscalYears[0])
    : (fiscalYears.find(f => new Date(f.start_date) <= today && today <= new Date(f.end_date)) ?? fiscalYears[0])

  const transactions = await getTransactions(selectedFY?.id)

  return (
    <>
      <TransactionsClient
        key={selectedFY?.id ?? 'no-fy'}
        transactions={transactions}
        fiscalYears={fiscalYears}
        selectedFY={selectedFY ?? null}
        filterSymbol={symbol?.toUpperCase()}
      />
      <BottomNav />
    </>
  )
}
