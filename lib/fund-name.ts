// How a mutual fund's name is shown (progress log #179). `mf_funds.scheme_name` keeps the name as
// AMFI gives it ("Example Liquid Fund - Direct Plan - Growth"); every screen shows it through
// `fundDisplayName`, so old rows (saved short by hand) and new ones (picked from the AMFI search)
// read the same. Pure and client-safe — no AMFI or Supabase imports.

/**
 * "Example Liquid Fund - Direct Plan - Growth" -> "Example Liquid". Drops a trailing "Fund"
 * (but not the last word of "Fund of Fund"), "Direct Plan" and "Growth"; a Regular plan shows as
 * "Regular"; any other option ("IDCW Payout") is kept; hyphens become spaces. A name with no
 * plan part — every short name saved by hand — only has its hyphens cleaned.
 */
export function fundDisplayName(schemeName: string): string {
  const tail = schemeName.match(/(?:\s*-\s*)+(Direct|Regular) Plan\s*-\s*(.+)$/i)
  const base = (tail ? schemeName.slice(0, tail.index) : schemeName).trim().replace(/(?<!\sof)\s+Fund$/i, '')
  const parts = [base]
  if (tail?.[1].toLowerCase() === 'regular') parts.push('Regular')
  if (tail && !/^growth$/i.test(tail[2].trim())) parts.push(tail[2].trim())
  return parts.join(' ').replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim()
}
