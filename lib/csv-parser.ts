export interface ParsedRow {
  symbol: string
  exchange: string
  trade_date: string   // YYYY-MM-DD
  trade_type: 'buy' | 'sell'
  quantity: number
  price: number
  amount: number
  error?: string
}

export function parseDate(raw: string): string | null {
  // Handle YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim()
  // Handle DD-MMM-YYYY (e.g. 01-Apr-2025)
  const ddMmmYyyy = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim())
  if (ddMmmYyyy) {
    const months: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    }
    const m = months[ddMmmYyyy[2]]
    if (m) return `${ddMmmYyyy[3]}-${m}-${ddMmmYyyy[1]}`
  }
  // Handle DD/MM/YYYY
  const ddMmYyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim())
  if (ddMmYyyy) return `${ddMmYyyy[3]}-${ddMmYyyy[2]}-${ddMmYyyy[1]}`
  return null
}

export function parseCsv(text: string): ParsedRow[] {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/["\r]/g, ''))

  const col = (row: string[], name: string) => {
    const idx = header.indexOf(name)
    return idx >= 0 ? row[idx]?.trim().replace(/^"|"$/g, '') ?? '' : ''
  }

  return lines.slice(1).map(line => {
    const row = line.split(',')

    const symbol     = col(row, 'symbol').toUpperCase()
    const exchange   = col(row, 'exchange').toUpperCase() || 'NSE'
    const rawDate    = col(row, 'trade_date')
    const rawType    = col(row, 'trade_type').toLowerCase()
    const rawQty     = col(row, 'quantity')
    const rawPrice   = col(row, 'price')

    const trade_date = parseDate(rawDate)
    const trade_type = rawType === 'buy' ? 'buy' : rawType === 'sell' ? 'sell' : null
    const quantity   = parseFloat(rawQty)
    const price      = parseFloat(rawPrice)

    const errors: string[] = []
    if (!symbol)             errors.push('missing symbol')
    if (!trade_date)         errors.push(`unrecognised date: ${rawDate}`)
    if (!trade_type)         errors.push(`unknown trade_type: ${rawType}`)
    if (isNaN(quantity) || quantity <= 0) errors.push('invalid quantity')
    if (isNaN(price)    || price    <= 0) errors.push('invalid price')

    return {
      symbol,
      exchange,
      trade_date: trade_date ?? '',
      trade_type: (trade_type ?? 'buy') as 'buy' | 'sell',
      quantity: isNaN(quantity) ? 0 : quantity,
      price:    isNaN(price)    ? 0 : price,
      amount:   (isNaN(quantity) ? 0 : quantity) * (isNaN(price) ? 0 : price),
      error: errors.length ? errors.join('; ') : undefined,
    }
  })
}
