// Gold (SGB/ETF/physical) batch grouping + valuation — shared by the Portfolio
// list (app/portfolio/PortfolioClient.tsx) and the Gold batch detail page
// (app/portfolio/gold/[key]/).
import { trimZero, monthYear } from './formatter'
import { sgbXirr } from './xirr'
import type { SGBTransaction, SGBBatch } from './portfolio-types'

// Pure grouping key, no price needed — lets the detail page filter the full
// transaction list down to one batch server-side. Must be byte-identical
// whether computed client-side (PortfolioClient builds the /portfolio/gold/[key]
// link) or server-side (the detail page matches it) — monthYear() is a plain
// string parse with no timezone dependence, unlike a Date-object round-trip.
export function keyForSGBTransaction(t: SGBTransaction): string {
  const goldType = t.gold_type ?? 'sgb'
  return goldType === 'sgb'
    ? monthYear(t.trade_date)
    : (t.name ?? (goldType === 'physical' ? 'Physical Gold' : 'Gold ETF'))
}

export function aggregateSGBBatch(key: string, transactions: SGBTransaction[], goldPrice: number | null): SGBBatch {
  let grams = 0
  let invested = 0
  let maturityDate: string | null = null
  // goldType/name are fixed from the batch's first transaction, matching how the
  // batch was originally seeded when grouped — later transactions in the same
  // batch don't overwrite them even if their own name/gold_type field differs.
  const goldType: 'sgb' | 'etf' | 'physical' = transactions[0]?.gold_type ?? 'sgb'
  const name: string | null = transactions[0]?.name ?? null

  for (const t of transactions) {
    if (t.trade_type === 'buy') {
      grams    += t.grams
      invested += t.amount
      if (!maturityDate && goldType === 'sgb') maturityDate = t.maturity_date
    } else {
      const avgPpg = grams > 0 ? invested / grams : 0
      grams    -= t.grams
      invested -= t.grams * avgPpg
    }
  }

  const inv = Math.max(0, invested)
  const currentValue = goldPrice !== null ? grams * goldPrice : null
  const gain = currentValue !== null ? currentValue - inv : null

  return {
    key,
    transactions,
    grams,
    invested: inv,
    maturityDate,
    currentValue,
    gain,
    xirr: currentValue !== null ? sgbXirr(transactions, currentValue) : null,
    goldType,
    name,
  }
}

export function computeSGBBatches(transactions: SGBTransaction[], goldPrice: number | null): SGBBatch[] {
  const groups = new Map<string, SGBTransaction[]>()
  for (const t of transactions) {
    const key = keyForSGBTransaction(t)
    ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(t)
  }
  return Array.from(groups.entries())
    .map(([key, txns]) => aggregateSGBBatch(key, txns, goldPrice))
    .filter(b => b.grams > 0.001)
}

export function goldDisplayName(b: Pick<SGBBatch, 'goldType' | 'key' | 'name'>): string {
  if (b.goldType === 'sgb') return `SGB ${b.key}`
  if (b.goldType === 'etf') return b.name ?? b.key
  return b.name || 'Physical Gold'
}

export function goldMeta(b: Pick<SGBBatch, 'goldType' | 'grams' | 'maturityDate'>): string {
  if (b.goldType === 'sgb') {
    const matDate = b.maturityDate ? monthYear(b.maturityDate) : '—'
    return `${trimZero(b.grams)}g · ${matDate}`
  }
  if (b.goldType === 'etf') return `${trimZero(b.grams)} units`
  return `${trimZero(b.grams)}g`
}
