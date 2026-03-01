// Indian currency formatting: ₹1.2L, ₹24L, ₹2.4Cr

const CR  = 1_00_00_000
const LAC = 1_00_000
const K   = 1_000

function compact(v: number): string {
  if (v >= 100)              return Math.round(v).toString()
  if (v === Math.floor(v))   return v.toString()
  return v.toFixed(1)
}

export function formatINR(amount: number): string {
  const abs  = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''

  if (abs >= CR)  return `${sign}₹${compact(abs / CR)}Cr`
  if (abs >= LAC) return `${sign}₹${compact(abs / LAC)}L`
  if (abs >= K)   return `${sign}₹${compact(abs / K)}K`
  return `${sign}₹${Math.round(abs)}`
}

export function formatPnL(amount: number): string {
  return (amount >= 0 ? '+' : '') + formatINR(amount)
}

export function formatPct(pct: number, decimals = 1): string {
  return `${pct.toFixed(decimals)}%`
}

/** ₹1,25,000 style full Indian comma formatting */
export function formatINRFull(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Parse "YYYY-MM-DD" to a display string like "12 Mar 2025" */
export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Today as YYYY-MM-DD */
export function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

/** Infer FY label from a date: Apr–Mar cycle → "FY25" */
export function fyLabel(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const month = d.getMonth() + 1  // 1-indexed
  const year  = d.getFullYear()
  const fyEnd = month >= 4 ? year + 1 : year
  return `FY${(fyEnd % 100).toString().padStart(2, '0')}`
}
