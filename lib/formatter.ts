// Indian currency formatting: ₹1.2L, ₹24L, ₹2.4Cr

const CR  = 1_00_00_000
const LAC = 1_00_000
const K   = 1_000

function compact(v: number): string {
  if (v >= 100)              return Math.round(v).toString()
  if (v === Math.floor(v))   return v.toString()
  return parseFloat(v.toFixed(1)).toString()
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

/** Compact Indian amount with up to 2 decimal places; trailing zeros stripped.
 * 132_000 → "₹1.32L", 130_000 → "₹1.3L", 100_000 → "₹1L", 8_400 → "₹8,400" */
export function formatINRFine(amount: number): string {
  const abs  = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= CR)  return `${sign}₹${parseFloat((abs / CR).toFixed(2))}Cr`
  if (abs >= LAC) return `${sign}₹${parseFloat((abs / LAC).toFixed(2))}L`
  if (abs >= K)   return `${sign}₹${parseFloat((abs / K).toFixed(2))}K`
  return `${sign}₹${Math.round(abs)}`
}

/** Price with up to 2 decimal places — for avg cost display.
 * Comma rules match formatPrice: no commas below ₹10,000. */
export function formatPriceFine(price: number): string {
  const v = parseFloat(price.toFixed(2))
  if (v < 10000) return `₹${v}`
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

/** Price display: no commas below ₹10,000; Indian locale (en-IN) above — e.g. ₹1284, ₹14,800, ₹1,48,000 */
export function formatPrice(price: number): string {
  const n = Math.round(price)
  return n < 10000 ? `₹${n}` : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

/** Same as formatPrice but without the ₹ — for use inside range strings like ₹1100–1220 */
export function formatPriceNum(price: number): string {
  const n = Math.round(price)
  return n < 10000 ? `${n}` : `${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

/** Full Indian-locale number with ₹ prefix — e.g. ₹33,40,000 (for hero display) */
export function formatINRFull(amount: number): string {
  const abs  = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

/** Same as formatINRFull but without the ₹ — for use when ₹ lives in the label */
export function formatINRFullNum(amount: number): string {
  const abs  = Math.abs(amount)
  const sign = amount < 0 ? '−' : ''
  return `${sign}${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
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

/** Strip trailing zeros after a fixed-precision format: 1.50 → "1.5", 1.00 → "1" */
export function trimZero(n: number, dp = 1): string {
  const s = n.toFixed(dp)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** XIRR as a compact percentage string, or "—" for null */
export function formatXirr(v: number | null): string {
  if (v === null) return '—'
  return `${trimZero(v * 100)}%`
}

/** Gain formatted with sign using formatINRFine, or "—" for null */
export function formatPnLFine(gain: number | null): string {
  if (gain === null) return '—'
  return (gain >= 0 ? '+' : '') + formatINRFine(gain)
}

/** Gain formatted with sign using formatINRFull, or "—" for null */
export function formatPnLFull(gain: number | null): string {
  if (gain === null) return '—'
  return (gain >= 0 ? '+' : '') + formatINRFull(gain)
}

/** Gain as a percentage of invested, with sign. Empty string when gain is null or invested is 0 */
export function formatGainPct(gain: number | null, invested: number): string {
  if (gain === null || invested <= 0) return ''
  return `${gain >= 0 ? '+' : ''}${trimPct((gain / invested) * 100)}%`
}

/** Percentage with trailing ".0" stripped: 12.0 → "12", 12.5 → "12.5" */
export function trimPct(v: number): string {
  const s = v.toFixed(1)
  return s.endsWith('.0') ? String(Math.round(v)) : s
}

/** Gain color token: positive → --c-positive, negative → --c-negative, null → fallback */
export function getGainColor(value: number | null, fallback = 'var(--text-primary)'): string {
  if (value === null) return fallback
  return value >= 0 ? 'var(--c-positive)' : 'var(--c-negative)'
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
