import { parseDDMonYYYY, MONTH_ABBR } from '@/lib/formatter'

const AMFI_NAV_HISTORY_URL = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx'
const AMFI_NAV_ALL_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt'

export interface AmfiNavHistoryRow {
  schemeCode: string
  nav: number
  navDate: string // "YYYY-MM-DD"
}

/**
 * Parses AMFI's semicolon-delimited NAV rows — "Scheme Code;ISIN;ISIN;Scheme
 * Name;Plan;Option;NAV;Date" — interleaved with blank lines and category/
 * fund-house header lines (no semicolons, or a non-numeric first field), which
 * are skipped. Shared by NAVAll.txt (one row per scheme) and the dated history
 * report (one row per scheme per date in range) — same 8 fields either way.
 */
export function parseAmfiNavHistory(text: string): AmfiNavHistoryRow[] {
  const rows: AmfiNavHistoryRow[] = []
  for (const line of text.split('\n')) {
    const fields = line.split(';')
    if (fields.length !== 8) continue
    const schemeCode = fields[0].trim()
    if (!/^\d+$/.test(schemeCode)) continue
    const nav = parseFloat(fields[6])
    const navDate = parseDDMonYYYY(fields[7].trim())
    if (!navDate || isNaN(nav) || nav <= 0) continue
    rows.push({ schemeCode, nav, navDate })
  }
  return rows
}

/** "DD-Mon-YYYY", AMFI's own request-param format — the inverse of parseDDMonYYYY. */
function formatDDMonYYYY(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0')
  return `${dd}-${MONTH_ABBR[date.getMonth()]}-${date.getFullYear()}`
}

/**
 * Fetches `url` and parses it as AMFI NAV rows. AMFI sometimes answers HTTP 200 with
 * an HTML form page instead of a report, which parses to zero rows — that throws
 * rather than passing for "nothing new". No `next: revalidate`: syncMfNav is only ever
 * run by the Portfolio Prices button, which must get a fresh feed, not a cached one.
 */
async function fetchAmfiRows(url: string, label: string): Promise<AmfiNavHistoryRow[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`AMFI ${label} fetch failed: ${res.status}`)
  const rows = parseAmfiNavHistory(await res.text())
  if (rows.length === 0) throw new Error(`AMFI ${label} had no NAV rows`)
  return rows
}

/**
 * Fetches AMFI's dated NAV history report for [fromDate, toDate] (inclusive,
 * calendar days) — every scheme repeated once per trading date in range, not
 * just the latest.
 */
export function fetchAmfiNavHistory(fromDate: Date, toDate: Date): Promise<AmfiNavHistoryRow[]> {
  const url = `${AMFI_NAV_HISTORY_URL}?frmdt=${formatDDMonYYYY(fromDate)}&todt=${formatDDMonYYYY(toDate)}`
  return fetchAmfiRows(url, 'NAV history')
}

/**
 * Fetches AMFI's latest-only feed (NAVAll.txt) — one row per scheme at its most
 * recent NAV date. ~1.5 MB / ~0.3 s against ~9 MB / 2–5 s for the 10-day history
 * report, so it is the syncMfNav fast path.
 */
export function fetchAmfiLatestNavs(): Promise<AmfiNavHistoryRow[]> {
  return fetchAmfiRows(AMFI_NAV_ALL_URL, 'latest NAV')
}

/**
 * True when `navDate` is more than `maxDays` calendar days behind `today` —
 * guards the 1D-gain calc, which assumes the latest NAV is from a genuine
 * single trading day back. 4 days covers an ordinary weekend/holiday gap
 * without flagging it; a wider gap means the feed itself is stuck, and
 * blending that move into "1D" would overstate the day's gain — the failure
 * mode behind #112's 202% figure (then an annualised 1D XIRR, since retired).
 */
export function isNavStale(navDate: string, today: Date = new Date(), maxDays = 4): boolean {
  const nav = new Date(navDate + 'T00:00:00')
  const asOf = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = (asOf.getTime() - nav.getTime()) / 86_400_000
  return days > maxDays
}
