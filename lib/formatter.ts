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

/** Same as formatINR but without the ₹ prefix */
export function formatAmt(amount: number): string {
  return formatINR(amount).replace('₹', '')
}

/** Parse "YYYY-MM-DD" → "12 Mar" (current year) or "12 Mar '25" (other year) */
export function formatDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00')
  const base = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return d.getFullYear() === new Date().getFullYear()
    ? base
    : base + " '" + String(d.getFullYear()).slice(2)
}

/** "Mar '26" — compact month + 2-digit year, e.g. for band anchor timestamps */
export function shortMonthYear(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2)
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
