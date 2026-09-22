import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseServiceClient } from '@/lib/supabase-service'
import { fetchAmfiNavHistory } from '@/lib/amfi'

// Re-sync at most once per interval, checked against "did we last *attempt* a
// sync recently" — not "does today have rows," which is false on every
// weekend/holiday and before AMFI's ~9-11pm IST publish, and would refetch on
// every page load. See progress log #117.
const SYNC_INTERVAL_HOURS = 12

// Clears the worst holiday cluster (a calendar week can hold as few as 2
// trading days) while staying one fixed, unchanging request — no backfill
// path, no hole repair, no chunking.
const WINDOW_DAYS = 10

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { force?: boolean }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createSupabaseServiceClient()

  const { data: state } = await service
    .from('mf_nav_sync_state')
    .select('last_attempt_at')
    .eq('id', 1)
    .maybeSingle()

  const now = new Date()
  if (!body.force && state?.last_attempt_at) {
    const hoursSince = (now.getTime() - new Date(state.last_attempt_at).getTime()) / 3_600_000
    if (hoursSince < SYNC_INTERVAL_HOURS) {
      return NextResponse.json({ synced: false, reason: 'recent', lastAttemptAt: state.last_attempt_at })
    }
  }

  const toDate = now
  const fromDate = new Date(now)
  fromDate.setDate(fromDate.getDate() - WINDOW_DAYS)

  try {
    const rows = await fetchAmfiNavHistory(fromDate, toDate)

    // Every user's mf_funds shares this table — not just the caller's, and not
    // just currently-held funds (a re-bought fund needs continuous history, and
    // the Tax screen needs sold funds' history too).
    const { data: fundRows } = await service.from('mf_funds').select('scheme_code')
    const schemeCodes = new Set((fundRows ?? []).map(r => r.scheme_code as string))
    const filtered = rows.filter(r => schemeCodes.has(r.schemeCode))

    if (filtered.length > 0) {
      const { error } = await service
        .from('mf_nav_history')
        .upsert(
          filtered.map(r => ({ scheme_code: r.schemeCode, nav_date: r.navDate, nav: r.nav })),
          { onConflict: 'scheme_code,nav_date' }
        )
      if (error) throw new Error(error.message)
    }

    await service.from('mf_nav_sync_state').update({ last_attempt_at: now.toISOString() }).eq('id', 1)

    return NextResponse.json({ synced: true, rowsUpserted: filtered.length, schemeCodes: schemeCodes.size })
  } catch (err) {
    // Write the watermark even on failure — an AMFI outage shouldn't get
    // retried on every page load within the interval either.
    await service.from('mf_nav_sync_state').update({ last_attempt_at: now.toISOString() }).eq('id', 1)
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
