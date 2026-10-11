import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// Retired in #153: a USD holding is a stock on `transactions` and uses /portfolio/stock/[symbol].
// This keeps old links and bookmarks working until the table itself is dropped in #155.
export default async function UsHoldingRedirect({
  params,
}: {
  params: Promise<{ holdingId: string }>
}) {
  const { holdingId } = await params

  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) redirect('/login')

  const { data } = await sb.from('us_holdings').select('symbol').eq('id', holdingId).maybeSingle()
  redirect(data?.symbol ? `/portfolio/stock/${encodeURIComponent(data.symbol)}` : '/portfolio')
}
