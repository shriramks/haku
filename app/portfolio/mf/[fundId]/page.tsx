import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getMFFunds, getMFTransactions, getMFNavHistory } from '@/lib/data'
import MFFundDetailClient from './MFFundDetailClient'
import BottomNav from '@/components/BottomNav'

export default async function MFFundDetailPage({
  params,
}: {
  params: Promise<{ fundId: string }>
}) {
  const { fundId } = await params

  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  // Both come from lib/data.ts's unstable_cache-wrapped getters — filtering in
  // memory here avoids a fresh, uncached DB round trip on every fund-detail visit.
  const [mfFunds, mfTransactions] = await Promise.all([
    getMFFunds(),
    getMFTransactions(),
  ])

  const fund = mfFunds.find(f => f.id === fundId)
  if (!fund) redirect('/portfolio')
  const transactions = mfTransactions.filter(t => t.fund_id === fundId)

  const navHistory = await getMFNavHistory([fund.scheme_code])
  const navInfo = navHistory[fund.scheme_code]

  return (
    <>
      <MFFundDetailClient
        fund={fund}
        transactions={transactions}
        nav={navInfo?.nav ?? null}
        prevNav={navInfo?.prevNav ?? null}
        navDate={navInfo?.navDate ?? null}
      />
      <BottomNav />
    </>
  )
}
