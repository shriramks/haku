// S&P 500 trailing PE from multpl.com (progress log #160). Pure parsers and guards live here with the
// fetch, so each rule is unit-tested without the network.

const PE_URL = 'https://www.multpl.com/s-p-500-pe-ratio/table/by-month'

/** Sane S&P 500 trailing PE. Outside this the page is mis-parsed or the basis has changed. */
export const SP500_PE_MIN = 14
export const SP500_PE_MAX = 35
/** The latest multpl reading is a market close; older than this many days means the page has stopped updating. */
export const MAX_PE_AGE_DAYS = 10

export interface MultplPe { pe: number; asOf: string }

/** Latest row of multpl's monthly S&P 500 PE table: the value and its date. */
export function parseMultplPe(html: string): MultplPe {
  const table = html.match(/<table[^>]*id="datatable"[^>]*>([\s\S]*?)<\/table>/)?.[1]
  if (!table) throw new Error('multpl table not found')
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const m = row[1].match(/<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/)
    if (!m) continue
    const pe = parseFloat(m[2].replace(/<[^>]*>/g, '').replace(/&#x2002;|&nbsp;|†/g, '').trim())
    if (Number.isFinite(pe)) return { pe, asOf: m[1] }
  }
  throw new Error('multpl PE row not found')
}

export function checkSp500PeRange(pe: number): void {
  if (!(pe >= SP500_PE_MIN && pe <= SP500_PE_MAX)) {
    throw new Error(`S&P 500 PE ${pe} outside sane range (${SP500_PE_MIN}–${SP500_PE_MAX}) — possible parse error or methodology change`)
  }
}

/** Throws when the reading's date is unreadable or more than MAX_PE_AGE_DAYS before `now`. */
export function checkPeFresh(asOf: string, now: Date): void {
  const t = Date.parse(`${asOf} 00:00:00 UTC`)
  if (Number.isNaN(t)) throw new Error(`multpl PE date "${asOf}" is unreadable`)
  if ((now.getTime() - t) / 86_400_000 > MAX_PE_AGE_DAYS) {
    throw new Error(`multpl PE is stale (last reading ${asOf})`)
  }
}

/** Fresh S&P 500 PE from multpl, range-guarded and freshness-checked. */
export async function fetchSp500Pe(now = new Date()): Promise<number> {
  const res = await fetch(PE_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`multpl fetch failed: ${res.status}`)
  const { pe, asOf } = parseMultplPe(await res.text())
  checkSp500PeRange(pe)
  checkPeFresh(asOf, now)
  return pe
}
