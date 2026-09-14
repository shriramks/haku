import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import MFFundDetailClient from './MFFundDetailClient'
import BottomNav from '@/components/BottomNav'
import type { MFund, MFTransaction } from '@/lib/portfolio-types'

export default async function MFFundDetailPage({
  params,
}: {
  params: Promise<{ fundId: string }>
}) {
  const { fundId } = await params

  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  const userId = session.user.id
  const svc    = createSupabaseServiceClient()

  const [{ data: fundRow }, { data: transactions }] = await Promise.all([
    svc.from('mf_funds').select('id, scheme_code, scheme_name, scheme_type').eq('id', fundId).eq('user_id', userId).maybeSingle(),
    svc.from('mf_transactions').select('id, fund_id, trade_date, trade_type, units, nav, amount').eq('fund_id', fundId).eq('user_id', userId).order('trade_date', { ascending: true }).order('trade_type', { ascending: true }),
  ])

  if (!fundRow) redirect('/portfolio')

  return (
    <>
      <MFFundDetailClient
        fund={fundRow as MFund}
        transactions={(transactions ?? []) as MFTransaction[]}
      />
      <BottomNav />
    </>
  )
}
