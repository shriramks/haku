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
