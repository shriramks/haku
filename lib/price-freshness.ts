// Pure helpers for "how old are the saved prices" on the Portfolio screen — no server imports, so
// page.tsx and PortfolioClient can share them. See progress log #121.b and docs/architecture.md
// "Price Fetch Flow".

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
/** 3:30 pm IST is 10:00 UTC (IST has no daylight saving). */
const MARKET_CLOSE_UTC_HOUR = 10
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The most recent Mon–Fri 3:30 pm IST at or before `now`. Exchange holidays are ignored on purpose:
 * a holiday only makes prices look stale for one extra tap, and a calendar would need yearly upkeep.
 */
export function lastMarketClose(now: Date): Date {
  const close = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), MARKET_CLOSE_UTC_HOUR))
  if (close.getTime() > now.getTime()) close.setUTCDate(close.getUTCDate() - 1)
  // 10:00 UTC and 15:30 IST fall on the same calendar date, so the UTC weekday is the IST weekday.
  while (close.getUTCDay() === 0 || close.getUTCDay() === 6) close.setUTCDate(close.getUTCDate() - 1)
  return close
}

/** The latest of a set of ISO timestamps (compared as instants, so mixed offsets are fine), or null. */
export function newestTimestamp(timestamps: (string | null | undefined)[]): string | null {
  let best: string | null = null
  let bestMs = -Infinity
  for (const ts of timestamps) {
    if (!ts) continue
    const ms = new Date(ts).getTime()
    if (!Number.isNaN(ms) && ms > bestMs) { best = ts; bestMs = ms }
  }
  return best
}

/**
 * True when the saved prices predate the last market close — a tap now would fetch a newer close —
 * or when there are none yet (`null`).
 */
export function pricesAreStale(newestFetchedAt: string | null, now: Date): boolean {
  if (newestFetchedAt === null) return true
  const fetchedMs = new Date(newestFetchedAt).getTime()
  if (Number.isNaN(fetchedMs)) return true
  return fetchedMs < lastMarketClose(now).getTime()
}

/** The IST calendar day (YYYY-MM-DD) of a timestamp, or null if it does not parse. */
export function istDay(iso: string): string | null {
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? null : new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Of a map key → 'YYYY-MM-DD', the entries older than the newest one — the holdings whose price is
 * a day (or more) behind the rest. Empty when everything is on the same day.
 */
export function laggingDates(dates: Record<string, string>): Record<string, string> {
  const values = Object.values(dates)
  if (values.length === 0) return {}
  const newest = values.reduce((a, b) => (b > a ? b : a))
  const lagging: Record<string, string> = {}
  for (const [key, day] of Object.entries(dates)) if (day < newest) lagging[key] = day
  return lagging
}

/** '2026-09-24' → '24 Sep'. String parse with a fixed month table: identical on server and browser. */
export function shortDate(isoDay: string): string {
  const month = parseInt(isoDay.slice(5, 7), 10)
  const day = parseInt(isoDay.slice(8, 10), 10)
  return `${day} ${MONTH_ABBR[month - 1]}`
}
