import type { SupabaseClient } from '@supabase/supabase-js'
import type { FiscalYear } from './types'

/** Selects the active FY from a list. If fyParam is given, finds by label; otherwise picks the FY whose date range contains today, falling back to the most recent. */
export function getCurrentFY(fiscalYears: FiscalYear[], fyParam?: string): FiscalYear | null {
  if (!fiscalYears.length) return null
  if (fyParam) return fiscalYears.find(f => f.label === fyParam) ?? fiscalYears[fiscalYears.length - 1]
  const today = new Date()
  return fiscalYears.find(fy =>
    new Date(fy.start_date) <= today && today <= new Date(fy.end_date)
  ) ?? fiscalYears[fiscalYears.length - 1]
}

/** Indian FY runs Apr–Mar. Returns the calendar year the FY containing `d` ends in (e.g. 2025 for FY25). */
export function fyEndYear(d: Date): number {
  return (d.getMonth() + 1) >= 4 ? d.getFullYear() + 1 : d.getFullYear()
}

/** Start/end ISO dates of the FY containing the given date. */
export function fyDateRange(date: Date | string): { start: string; end: string } {
  const d = typeof date === 'string' ? new Date(date) : date
  const end = fyEndYear(d)
  return { start: `${end - 1}-04-01`, end: `${end}-03-31` }
}

/**
 * Looks up the fiscal_years row whose range contains the given trade date.
 * fy_id must always be derived from trade_date — including on edits — never
 * carried over from a previous value.
 * Pass `userId` when calling with the service client (no RLS scoping).
 */
export async function fyIdForDate(sb: SupabaseClient, dateStr: string, userId?: string): Promise<string | null> {
  const { start, end } = fyDateRange(dateStr)
  let q = sb
    .from('fiscal_years').select('id')
    .gte('start_date', start)
    .lte('end_date', end)
  if (userId) q = q.eq('user_id', userId)
  const { data } = await q.limit(1)
  return data?.[0]?.id ?? null
}

/** Fiscal quarter label, e.g. "FY26 Q1" for a date in Apr–Jun 2025. */
export function fiscalQuarterLabel(d: Date): string {
  const month = d.getMonth() + 1 // 1-based
  const quarter = month >= 4 && month <= 6 ? 'Q1'
    : month >= 7 && month <= 9 ? 'Q2'
    : month >= 10 && month <= 12 ? 'Q3'
    : 'Q4'
  return `FY${String(fyEndYear(d)).slice(-2)} ${quarter}`
}
