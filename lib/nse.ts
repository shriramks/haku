import type { DividendEntry } from '@/lib/screener'

const NSE_MONTH: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

function parseNseDate(raw: string): string | null {
  // "30-Jan-2026" → "2026-01-30"
  const m = raw.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/)
  if (!m) return null
  const month = NSE_MONTH[m[2]]
  if (!month) return null
  return `${m[3]}-${month}-${m[1].padStart(2, '0')}`
}

function parseNseAmount(subject: string): number {
  // Sums all "Rs X.XX Per Share" occurrences — handles combined subjects like
  // "Interim Dividend - Rs 14.5 Per Share/Special Dividend - Rs 10.5 Per Share"
  const re = /Rs\s+([\d.]+)\s+Per\s+Share/gi
  let total = 0, m
  while ((m = re.exec(subject)) !== null) total += parseFloat(m[1])
  return total
}

interface NseCorporateAction {
  subject: string
  exDate: string
}

export async function fetchNseDividends(symbol: string): Promise<DividendEntry[]> {
  const url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}&series=EQ`
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json',
      Referer: 'https://www.nseindia.com',
    },
  })
  if (!res.ok) throw new Error(`NSE corporate actions fetch failed: ${res.status} for ${symbol}`)

  const actions = (await res.json()) as NseCorporateAction[]
  const results: DividendEntry[] = []
  for (const action of actions) {
    if (!action.subject.toLowerCase().includes('dividend')) continue
    const ex_date = parseNseDate(action.exDate)
    if (!ex_date) continue
    const per_share = parseNseAmount(action.subject)
    if (per_share <= 0) continue
    results.push({ ex_date, per_share })
  }
  return results
}

export interface NseIndexData {
  level: number
  pe: number
  asOf: string
}

interface NseIndexEntry {
  index: string
  last: number
  pe: number
  [key: string]: unknown
}

export async function fetchNseIndex(indexName: string): Promise<NseIndexData> {
  const res = await fetch('https://www.nseindia.com/api/allIndices', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json',
      Referer: 'https://www.nseindia.com',
    },
  })
  if (!res.ok) throw new Error(`NSE fetch failed: ${res.status}`)

  const json = (await res.json()) as { data: NseIndexEntry[] }
  const entry = json.data.find(e => e.index === indexName)
  if (!entry) throw new Error(`Index "${indexName}" not found in NSE response`)

  return {
    level: entry.last,
    pe: entry.pe,
    asOf: new Date().toISOString(),
  }
}
