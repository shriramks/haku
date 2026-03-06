import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTransactions } from '@/lib/data'
import TransactionsClient from './TransactionsClient'
import BottomNav from '@/components/BottomNav'

export default async function TransactionsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const transactions = await getTransactions()

  return (
    <>
      <TransactionsClient transactions={transactions} />
      <BottomNav />
    </>
  )
}
