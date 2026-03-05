import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTransactions } from '@/lib/data'
import TxnsClient from './TxnsClient'
import BottomNav from '@/components/BottomNav'

export default async function TxnsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const transactions = await getTransactions()   // all FYs

  return (
    <>
      <TxnsClient transactions={transactions} />
      <BottomNav />
    </>
  )
}
