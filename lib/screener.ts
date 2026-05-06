import { parse } from 'node-html-parser'

export interface ScreenerData {
  eps: number
  patNow: number
  pat3yrAgo: number
  roce3yrAvg: number
  mcap: number
  asOf: string
}

function parseNumber(raw: string): number {
  return parseFloat(raw.replace(/,/g, '').trim())
}

function getRowValues(tableEl: ReturnType<typeof parse>, rowLabel: string): number[] {
  const rows = tableEl.querySelectorAll('tr')
  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length === 0) continue
    const label = cells[0].text.trim().replace(/\s*\+$/, '')
    if (label === rowLabel) {
      return cells
        .slice(1)
        .map(td => td.text.trim())
        .filter(v => v !== '')
        .map(parseNumber)
    }
  }
  return []
}

async function fetchScreenerHtml(symbol: string, consolidated: boolean): Promise<string> {
  const path = consolidated
    ? `https://www.screener.in/company/${symbol}/consolidated/`
    : `https://www.screener.in/company/${symbol}/`
  const res = await fetch(path, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
  })
  if (!res.ok) throw new Error(`Screener fetch failed: ${res.status} for ${symbol}`)
  return res.text()
}

export async function fetchScreenerData(symbol: string): Promise<ScreenerData> {
  let html = await fetchScreenerHtml(symbol, true)
  let doc = parse(html)

  // If the consolidated page has no EPS data (company has no subsidiaries), use standalone
  let plSection = doc.querySelector('#profit-loss')
  if (!plSection) throw new Error(`#profit-loss section not found for ${symbol}`)
  if (getRowValues(plSection, 'EPS in Rs').length === 0) {
    html = await fetchScreenerHtml(symbol, false)
    doc = parse(html)
  }

  // --- EPS and PAT from #profit-loss (annual table) ---
  plSection = doc.querySelector('#profit-loss')
  if (!plSection) throw new Error(`#profit-loss section not found for ${symbol}`)

  const epsValues = getRowValues(plSection, 'EPS in Rs')
  if (epsValues.length < 1) throw new Error(`EPS row not found for ${symbol}`)
  const eps = epsValues[epsValues.length - 1]

  const patValues = getRowValues(plSection, 'Net Profit')
  if (patValues.length < 4) throw new Error(`Not enough PAT data for ${symbol}`)
  const patNow = patValues[patValues.length - 1]
  const pat3yrAgo = patValues[patValues.length - 4]

  // asOf: rightmost header column in #profit-loss thead
  const thCells = plSection.querySelectorAll('thead th')
  const asOf =
    thCells.length > 1 ? thCells[thCells.length - 1].text.trim() : ''

  // --- ROCE from #ratios ---
  const ratiosSection = doc.querySelector('#ratios')
  if (!ratiosSection) throw new Error(`#ratios section not found for ${symbol}`)

  const roceValues = getRowValues(ratiosSection, 'ROCE %')
  if (roceValues.length < 3) throw new Error(`Not enough ROCE data for ${symbol}`)
  const last3 = roceValues.slice(-3)
  const roce3yrAvg = last3.reduce((a, b) => a + b, 0) / last3.length

  // --- Market Cap from #top-ratios ---
  const topRatios = doc.querySelector('#top-ratios')
  if (!topRatios) throw new Error(`#top-ratios section not found for ${symbol}`)

  let mcap = NaN
  const liEls = topRatios.querySelectorAll('li')
  for (const li of liEls) {
    const name = li.querySelector('.name')?.text.trim() ?? ''
    if (name === 'Market Cap') {
      const raw = li.querySelector('.number')?.text.trim() ?? ''
      mcap = parseNumber(raw)
      break
    }
  }
  if (isNaN(mcap)) throw new Error(`Market Cap not found for ${symbol}`)

  return { eps, patNow, pat3yrAgo, roce3yrAvg, mcap, asOf }
}
