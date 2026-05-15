// Indian currency compact formatting: "1.32 L", "2.4 cr", "8.4 K" (thin space before unit)

const CR  = 1_00_00_000
const LAC = 1_00_000
const K   = 1_000

const THIN = ' '

/** Compact Indian amount with up to 2 decimal places; trailing zeros stripped.
 * 132_000 → "1.32 L", 130_000 → "1.3 L", 100_000 → "1 L", 8_400 → "8.4 K" */
export function formatINRFine(amount: number): string {
  const abs  = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= CR)  return `${sign}${parseFloat((abs / CR).toFixed(2))}${THIN}cr`
  if (abs >= LAC) return `${sign}${parseFloat((abs / LAC).toFixed(2))}${THIN}L`
  if (abs >= K)   return `${sign}${parseFloat((abs / K).toFixed(2))}${THIN}K`
  return `${sign}${Math.round(abs)}`
}

/** Splits a compact INR amount into digits + unit for the Num component.
 * Always uses absolute value — sign handling is the caller's responsibility. */
export function splitINR(amount: number): { digits: string; unit: string } {
  const abs = Math.abs(amount)
  if (abs >= CR)  return { digits: String(parseFloat((abs / CR).toFixed(2))),  unit: 'cr' }
  if (abs >= LAC) return { digits: String(parseFloat((abs / LAC).toFixed(2))), unit: 'L'  }
  if (abs >= K)   return { digits: String(parseFloat((abs / K).toFixed(2))),   unit: 'K'  }
  return { digits: String(Math.round(abs)), unit: '' }
}

/** Splits a percentage into digits + "%" unit for the Num component.
 * Always uses absolute value — sign handling is the caller's responsibility. */
export function splitPct(v: number): { digits: string; unit: string } {
  return { digits: trimPct(Math.abs(v)), unit: '%' }
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

/** Full Indian-locale number without ₹ — e.g. 33,40,000 */
export function formatINRFull(amount: number): string {
  const abs  = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  return `${sign}${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

/** Same as formatINRFull but uses proper minus sign */
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

/** Absolute gain as full Indian-locale amount, or "—" for null */
export function formatPnLFull(gain: number | null): string {
  if (gain === null) return '—'
  return formatINRFull(Math.abs(gain))
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
