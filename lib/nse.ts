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
