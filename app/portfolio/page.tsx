import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { getTransactions, getBuyBands } from '@/lib/data'
import PortfolioClient from './PortfolioClient'
import BottomNav from '@/components/BottomNav'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, PPFBalanceOverride } from '@/lib/portfolio-types'

export default async function PortfolioPage() {
  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  const userId = session.user.id
  const svc    = createSupabaseServiceClient()

  const [
    allTransactions,
    bands,
    { data: mfFunds },
    { data: mfTransactions },
    { data: sgbTransactions },
    { data: ppfTransactions },
    { data: ppfOverrideRows },
  ] = await Promise.all([
    getTransactions(),
    getBuyBands(),
    svc.from('mf_funds').select('*').eq('user_id', userId).order('scheme_name'),
    svc.from('mf_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: true }),
    svc.from('sgb_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: true }),
    svc.from('ppf_transactions').select('*').eq('user_id', userId).order('trade_date', { ascending: true }),
    svc.from('ppf_balance_override').select('*').eq('user_id', userId).limit(1),
  ])

  return (
    <>
      <PortfolioClient
        allTransactions={allTransactions}
        bands={bands}
        mfFunds={(mfFunds ?? []) as MFund[]}
        mfTransactions={(mfTransactions ?? []) as MFTransaction[]}
        sgbTransactions={(sgbTransactions ?? []) as SGBTransaction[]}
        ppfTransactions={(ppfTransactions ?? []) as PPFTransaction[]}
        ppfOverride={((ppfOverrideRows ?? [])[0] ?? null) as PPFBalanceOverride | null}
      />
      <BottomNav />
    </>
  )
}
