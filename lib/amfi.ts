import { parseDDMonYYYY } from '@/lib/formatter'

export interface AmfiNavEntry {
  nav: number
  date: string // "YYYY-MM-DD"
}

const AMFI_NAV_ALL_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt'

/**
 * Parses AMFI's bulk NAV file: semicolon-delimited data rows
 * "Scheme Code;ISIN;ISIN;Scheme Name;Plan;Option;NAV;Date" interleaved with
 * blank lines and category/fund-house header lines (no semicolons, or a
 * non-numeric first field) — those are skipped rather than parsed.
 */
export function parseAmfiNavAll(text: string): Map<string, AmfiNavEntry> {
  const result = new Map<string, AmfiNavEntry>()
  for (const line of text.split('\n')) {
    const fields = line.split(';')
    if (fields.length !== 8) continue
    const schemeCode = fields[0].trim()
    if (!/^\d+$/.test(schemeCode)) continue
    const nav = parseFloat(fields[6])
    const date = parseDDMonYYYY(fields[7].trim())
    if (!date || isNaN(nav) || nav <= 0) continue
    result.set(schemeCode, { nav, date })
  }
  return result
}

export async function fetchAmfiNavAll(): Promise<Map<string, AmfiNavEntry>> {
  const res = await fetch(AMFI_NAV_ALL_URL, { next: { revalidate: 1800 } })
  if (!res.ok) throw new Error(`AMFI NAVAll fetch failed: ${res.status}`)
  return parseAmfiNavAll(await res.text())
}

/**
 * True when `navDate` is more than `maxDays` calendar days behind `today` —
 * guards the 1D-gain calc, which assumes the latest NAV is from a genuine
 * single trading day back. 4 days covers an ordinary weekend/holiday gap
 * without flagging it; a wider gap means the feed itself is stuck (the
 * mfapi.in bug this replaces) and blending that move into "1D" would inflate
 * oneDayXirr's annualization, same failure mode as #112's 202% figure.
 */
export function isNavStale(navDate: string, today: Date = new Date(), maxDays = 4): boolean {
  const nav = new Date(navDate + 'T00:00:00')
  const asOf = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = (asOf.getTime() - nav.getTime()) / 86_400_000
  return days > maxDays
}

/** mfapi.in's own date format: "18-09-2026" → "2026-09-18". Distinct from AMFI's
 * "DD-Mon-YYYY" (parseDDMonYYYY) — the two feeds spell dates differently. */
export function parseMfapiDate(raw: string): string | null {
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

export interface MfapiHistory {
  nav: number | null
  date: string | null
  prevNav: number | null
  prevDate: string | null
}

const EMPTY_MFAPI_HISTORY: MfapiHistory = { nav: null, date: null, prevNav: null, prevDate: null }

/**
 * Fetches one scheme's NAV history from mfapi.in, with a hard timeout — its
 * per-scheme endpoint is known to hang (11s+) or fail outright, and a plain
 * fetch() with no AbortController lets one stuck request block a Promise.all
 * of many funds for minutes. Returns the two most recent entries; callers
 * needing only the latest NAV can ignore prevNav/prevDate.
 */
export async function fetchMfapiHistory(schemeCode: string, timeoutMs = 8000): Promise<MfapiHistory> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`, { signal: controller.signal })
    const json = await res.json()
    const nav = parseFloat(json.data?.[0]?.nav)
    const prevNav = parseFloat(json.data?.[1]?.nav)
    return {
      nav: isNaN(nav) ? null : nav,
      date: parseMfapiDate(json.data?.[0]?.date ?? ''),
      prevNav: isNaN(prevNav) ? null : prevNav,
      prevDate: parseMfapiDate(json.data?.[1]?.date ?? ''),
    }
  } catch {
    return EMPTY_MFAPI_HISTORY
  } finally {
    clearTimeout(timer)
  }
}
