import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSGBTransactions } from '@/lib/data'
import { keyForSGBTransaction } from '@/lib/sgb-compute'
import GoldDetailClient from './GoldDetailClient'
import BottomNav from '@/components/BottomNav'

export default async function GoldDetailPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  const { key } = await params

  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  const sgbTransactions = await getSGBTransactions()
  const transactions = sgbTransactions.filter(t => keyForSGBTransaction(t) === key)
  if (transactions.length === 0) redirect('/portfolio')

  return (
    <>
      <GoldDetailClient
        batchKey={key}
        transactions={transactions}
      />
      <BottomNav />
    </>
  )
}
