import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAmfiLatestNavs, fetchAmfiNavHistory, isNavStale, type AmfiNavHistoryRow } from './amfi'

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

const DAY_MS = 86_400_000

function utcDay(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/**
 * True when `feedDate` is the trading day straight after `savedDate` — 1 calendar day
 * later, or Friday → Monday. Only then is `saved.nav` provably the feed NAV's previous
 * day; any wider gap (a skipped tap day, an exchange holiday) could label a multi-day
 * move "1D" and even flip its sign, so those go to the exact 10-day window instead.
 */
function isNextTradingDay(savedDate: string, feedDate: string): boolean {
  const gap = (utcDay(feedDate) - utcDay(savedDate)) / DAY_MS
  return gap === 1 || (gap === 3 && new Date(utcDay(savedDate)).getUTCDay() === 5)
}

/**
 * Splits `schemeCodes` by what NAVAll's latest-only feed can settle, comparing NAV dates
 * (never tap time, so a fund that publishes next morning is fine):
 *  - feed date equals or precedes the saved date → nothing to do;
 *  - feed is the next trading day after the saved date → `rolled`: `nav` = feed,
 *    `prev_nav` = the saved nav, `nav_date` = feed;
 *  - no saved row, or any other gap → `fallback`, for the exact 10-day window logic.
 * A scheme absent from the feed produces nothing, so its saved row is left alone.
 * Accepted edge: a fund that publishes on weekends can get a Fri → Mon `prev_nav`.
 */
export function planNavUpdates(
  feed: AmfiNavHistoryRow[],
  saved: MfNavRow[],
  schemeCodes: ReadonlySet<string>,
): { rolled: MfNavRow[]; fallback: Set<string> } {
  const savedByCode = new Map(saved.map(r => [r.scheme_code, r]))
  const latest = new Map<string, AmfiNavHistoryRow>()
  for (const row of feed) {
    if (!schemeCodes.has(row.schemeCode)) continue
    const cur = latest.get(row.schemeCode)
    if (!cur || row.navDate > cur.navDate) latest.set(row.schemeCode, row)
  }

  const rolled: MfNavRow[] = []
  const fallback = new Set<string>()
  for (const [code, row] of latest) {
    const prior = savedByCode.get(code)
    if (!prior) fallback.add(code)
    else if (row.navDate <= prior.nav_date) continue
    else if (isNextTradingDay(prior.nav_date, row.navDate)) {
      rolled.push({ scheme_code: code, nav: row.nav, prev_nav: prior.nav, nav_date: row.navDate })
    } else fallback.add(code)
  }
  return { rolled, fallback }
}

/**
 * Reads every known scheme (every user's `mf_funds`, not just the caller's or the held
 * funds: `mf_navs` is shared market data, and a re-bought or sold fund still needs a NAV —
 * Tax reads sold funds' too; hence the deliberately unfiltered fund select) plus each
 * one's saved `mf_navs` row.
 */
async function readKnownSchemes(service: SupabaseClient): Promise<{ schemeCodes: Set<string>; saved: MfNavRow[] }> {
  const { data: fundRows, error: fundError } = await service.from('mf_funds').select('scheme_code')
  if (fundError) throw new Error(fundError.message)
  const schemeCodes = new Set((fundRows ?? []).map(r => r.scheme_code as string))
  if (schemeCodes.size === 0) return { schemeCodes, saved: [] }

  const { data, error } = await service
    .from('mf_navs')
    .select('scheme_code, nav, prev_nav, nav_date')
    .in('scheme_code', [...schemeCodes])
  if (error) throw new Error(error.message)
  const saved = ((data ?? []) as { scheme_code: string; nav: number | string; prev_nav: number | string | null; nav_date: string }[])
    .map(r => ({
      scheme_code: r.scheme_code,
      nav: Number(r.nav),
      prev_nav: r.prev_nav === null ? null : Number(r.prev_nav),
      nav_date: r.nav_date,
    }))
  return { schemeCodes, saved }
}

/**
 * Brings `mf_navs` up to AMFI's latest NAVs. Only the Prices button triggers this (via
 * the refresh route — progress log #120.a/#120.c/#128); there is no watermark. Idempotent
 * (an unchanged feed date is skipped), so repeat taps are harmless.
 *
 * Fast path: NAVAll (latest-only, ~0.3 s) read alongside the known schemes' saved rows;
 * `planNavUpdates` settles every scheme it can. Only schemes it can't (no saved row, or a
 * gap it can't prove is one trading day) trigger the 10-day window report (~9 MB, 2–5 s).
 * Rolled-forward rows are saved even when that fallback fetch fails; the failure still
 * throws afterwards. Throws on any failure — the caller decides whether that is fatal.
 */
export async function syncMfNav(service: SupabaseClient, now: Date = new Date()): Promise<void> {
  const [feed, { schemeCodes, saved }] = await Promise.all([fetchAmfiLatestNavs(), readKnownSchemes(service)])

  const { rolled, fallback } = planNavUpdates(feed, saved, schemeCodes)

  let windowRows: MfNavRow[] = []
  let windowError: unknown = null
  if (fallback.size > 0) {
    const fromDate = new Date(now)
    fromDate.setDate(fromDate.getDate() - WINDOW_DAYS)
    try {
      windowRows = latestNavRows(await fetchAmfiNavHistory(fromDate, now), fallback)
    } catch (err) {
      windowError = err
    }
  }

  const navRows = [...rolled, ...windowRows]
  if (navRows.length > 0) {
    const { error } = await service.from('mf_navs').upsert(navRows, { onConflict: 'scheme_code' })
    if (error) throw new Error(error.message)
  }
  if (windowError) throw windowError
}
