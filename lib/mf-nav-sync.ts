import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAmfiNavHistory, isNavStale, type AmfiNavHistoryRow } from './amfi'

// Clears the worst holiday cluster (a calendar week can hold as few as 2 trading days)
// while staying one fixed, unchanging request — no backfill path, no hole repair, no chunking.
const WINDOW_DAYS = 10

// A gap wider than this between a scheme's two newest rows isn't a genuine 1-day move
// (a stuck feed) — keeps it out of the portfolio 1D gain / 1D %; this guard is what
// stopped #112's 202% XIRR bug from recurring.
const PREV_NAV_MAX_GAP_DAYS = 4

export interface MfNavRow {
  scheme_code: string
  nav: number
  prev_nav: number | null
  nav_date: string
}

/**
 * Reduces AMFI's dated history (one row per scheme per date) to one `mf_navs` row per
 * scheme in `schemeCodes`: the newest NAV plus the one before it. `prev_nav` is null when
 * only one date exists or the two newest dates are more than PREV_NAV_MAX_GAP_DAYS apart.
 * Schemes with no row in `rows` produce nothing, so their saved row is left alone.
 */
export function latestNavRows(rows: AmfiNavHistoryRow[], schemeCodes: ReadonlySet<string>): MfNavRow[] {
  const top = new Map<string, { latest: AmfiNavHistoryRow; prev: AmfiNavHistoryRow | null }>()
  for (const row of rows) {
    if (!schemeCodes.has(row.schemeCode)) continue
    const cur = top.get(row.schemeCode)
    if (!cur) {
      top.set(row.schemeCode, { latest: row, prev: null })
    } else if (row.navDate > cur.latest.navDate) {
      cur.prev = cur.latest
      cur.latest = row
    } else if (row.navDate < cur.latest.navDate && (!cur.prev || row.navDate > cur.prev.navDate)) {
      cur.prev = row
    }
  }

  return [...top.values()].map(({ latest, prev }) => ({
    scheme_code: latest.schemeCode,
    nav: latest.nav,
    prev_nav: prev && !isNavStale(prev.navDate, new Date(latest.navDate + 'T00:00:00'), PREV_NAV_MAX_GAP_DAYS) ? prev.nav : null,
    nav_date: latest.navDate,
  }))
}

/**
 * Fetches AMFI's last WINDOW_DAYS of NAVs and upserts each known scheme's latest + previous
 * NAV into `mf_navs`. Only the Prices button triggers this (via the refresh route — progress
 * log #120.c); there is no watermark. Idempotent, so repeat taps and overlapping windows are
 * harmless. Throws on any failure — the caller decides whether that is fatal.
 *
 * The scheme filter is every user's `mf_funds`, not just the caller's or the held funds:
 * `mf_navs` is shared market data, and a re-bought or sold fund still needs a NAV
 * (Tax reads sold funds' too). Hence the deliberately unfiltered select.
 */
export async function syncMfNav(service: SupabaseClient, now: Date = new Date()): Promise<void> {
  const fromDate = new Date(now)
  fromDate.setDate(fromDate.getDate() - WINDOW_DAYS)

  const rows = await fetchAmfiNavHistory(fromDate, now)

  const { data: fundRows, error: fundError } = await service.from('mf_funds').select('scheme_code')
  if (fundError) throw new Error(fundError.message)
  const schemeCodes = new Set((fundRows ?? []).map(r => r.scheme_code as string))

  const navRows = latestNavRows(rows, schemeCodes)
  if (navRows.length === 0) return

  const { error } = await service.from('mf_navs').upsert(navRows, { onConflict: 'scheme_code' })
  if (error) throw new Error(error.message)
}
