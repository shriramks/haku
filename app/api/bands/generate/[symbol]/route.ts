import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { categoryFromSector } from '@/lib/sector-map'
import { calculateBands } from '@/lib/band-calculator'
import type { StockCategory } from '@/lib/types'

// Yahoo Finance quoteSummary modules we need
const MODULES = 'financialData,defaultKeyStatistics,incomeStatementHistory,balanceSheetHistory,assetProfile'

interface YahooFinancials {
  eps: number | null
  bvps: number | null
  ebitdaInCr: number | null      // ₹Cr
  netDebtInCr: number | null     // ₹Cr
  sharesInCr: number | null      // Cr shares
  sector: string
  industry: string
}

async function fetchYahooFinancials(symbol: string): Promise<YahooFinancials | null> {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}.NS?modules=${MODULES}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 3600 }, // cache 1h — financials don't change often
  })
  if (!res.ok) return null

  const json = await res.json()
  const result = json?.quoteSummary?.result?.[0]
  if (!result) return null

  const fd   = result.financialData ?? {}
  const ks   = result.defaultKeyStatistics ?? {}
  const is   = result.incomeStatementHistory?.incomeStatementHistory?.[0] ?? {}
  const bs   = result.balanceSheetHistory?.balanceSheetHistory?.[0] ?? {}
  const prof = result.assetProfile ?? {}

  // EPS (trailing, in ₹)
  const eps: number | null = ks.trailingEps?.raw ?? fd.epsTrailingTwelveMonths?.raw ?? null

  // Book value per share (in ₹)
  const bvps: number | null = ks.bookValue?.raw ?? null

  // Shares outstanding — Yahoo gives in absolute count, convert to Cr
  const sharesRaw: number | null = ks.sharesOutstanding?.raw ?? fd.sharesOutstanding?.raw ?? null
  const sharesInCr = sharesRaw ? sharesRaw / 1e7 : null  // 1 Cr = 10^7

  // EBITDA — Yahoo gives in absolute ₹, convert to ₹Cr
  const ebitdaRaw: number | null = fd.ebitda?.raw ?? is.ebitda?.raw ?? null
  const ebitdaInCr = ebitdaRaw ? ebitdaRaw / 1e7 : null

  // Net Debt = totalDebt − totalCash (in ₹Cr)
  const totalDebt: number | null  = bs.totalDebt?.raw ?? fd.totalDebt?.raw ?? null
  const totalCash: number | null  = fd.totalCash?.raw ?? bs.cash?.raw ?? null
  const netDebtInCr = (totalDebt !== null && totalCash !== null)
    ? (totalDebt - totalCash) / 1e7
    : (totalDebt !== null ? totalDebt / 1e7 : null)

  const sector   = prof.sector   ?? fd.sector   ?? ''
  const industry = prof.industry ?? fd.industry ?? ''

  return { eps, bvps, ebitdaInCr, netDebtInCr, sharesInCr, sector, industry }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch financial data from Yahoo Finance
  const fin = await fetchYahooFinancials(upperSymbol)
  if (!fin) return NextResponse.json({ error: 'Failed to fetch financials from Yahoo Finance' }, { status: 502 })

  // Auto-detect category from sector/industry
  let category: StockCategory | null = categoryFromSector(fin.sector, fin.industry)

  // If category can't be auto-detected, check if we have an existing allocation with one set
  if (!category) {
    const { data: alloc } = await supabase
      .from('stock_allocations')
      .select('category')
      .eq('user_id', user.id)
      .eq('symbol', upperSymbol)
      .limit(1)
      .single()
    if (alloc?.category) category = alloc.category as StockCategory
  }

  if (!category) {
    return NextResponse.json({
      error: `Could not determine category for ${upperSymbol} (sector: "${fin.sector}", industry: "${fin.industry}"). Set category manually in Allocation.`,
    }, { status: 422 })
  }

  // Fetch allocation flags (weak/strong quarters, hospital ramp phase)
  const { data: alloc } = await supabase
    .from('stock_allocations')
    .select('two_weak_quarters, two_strong_quarters, is_hospital_ramp_phase')
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .limit(1)
    .single()

  // Insurance: skip P/EV (no embedded value from free APIs), fall back to PE
  // The band-calculator already handles this — Insurance case tries tryPEV() which returns null
  // when embeddedValue is not provided, so it naturally returns null. We need to force PE fallback.
  // We do this by temporarily treating Insurance as using PE if EPS is available.
  let bandInput = {
    category,
    twoWeakQuarters:     alloc?.two_weak_quarters      ?? false,
    twoStrongQuarters:   alloc?.two_strong_quarters     ?? false,
    isHospitalRampPhase: alloc?.is_hospital_ramp_phase  ?? false,
    eps:        fin.eps,
    bvps:       fin.bvps,
    ebitda:     fin.ebitdaInCr,
    netDebt:    fin.netDebtInCr,
    shares:     fin.sharesInCr,
    embeddedValue: null, // never available from Yahoo Finance free API
  }

  let result = calculateBands(bandInput)

  // Insurance fallback: if P/EV failed (no embedded value), try PE
  if (!result && category === 'Insurance' && fin.eps && fin.eps > 0) {
    // Use FMCG PE multiples as a proxy (high-quality financial company range)
    // Actually per user decision: "fall back to PE if available" — use the PE table.
    // band-calculator doesn't have Insurance in the PE table, so we override category temporarily.
    result = calculateBands({ ...bandInput, category: 'FMCG' })
    if (result) {
      result = { ...result, anchorUsed: result.anchorUsed + ' [Insurance PE fallback]' }
    }
  }

  if (!result) {
    return NextResponse.json({
      error: `Insufficient financial data to compute bands for ${upperSymbol}. Available: EPS=${fin.eps}, BVPS=${fin.bvps}, EBITDA=${fin.ebitdaInCr}Cr, Shares=${fin.sharesInCr}Cr`,
    }, { status: 422 })
  }

  // Determine anchor_type for DB
  const anchorRaw = result.anchorUsed.toUpperCase()
  const anchor_type = anchorRaw.includes('EV/EBITDA') ? 'EV_EBITDA'
    : anchorRaw.includes('P/EV')     ? 'P_EV'
    : anchorRaw.includes('PB')       ? 'PB'
    : 'PE'

  // Mark existing current bands as not current
  await supabase
    .from('buy_bands')
    .update({ is_current: false })
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .eq('is_current', true)

  // Insert new band row
  const now = new Date().toISOString()
  const { data: newBand, error: insertError } = await supabase
    .from('buy_bands')
    .insert({
      user_id:      user.id,
      symbol:       upperSymbol,
      anchor_type,
      eps:          fin.eps,
      bvps:         fin.bvps,
      ebitda:       fin.ebitdaInCr,
      net_debt:     fin.netDebtInCr,
      shares:       fin.sharesInCr,
      embedded_value: null,
      buy_low:      result.buyLow,
      buy_high:     result.buyHigh,
      mid_low:      result.midLow,
      mid_high:     result.midHigh,
      trim_price:   result.trimPrice,
      manual_cmp:   null,
      notes:        result.anchorUsed,
      last_updated_at: now,
      generated_at: now,
      is_current:   true,
    })
    .select()
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({
    symbol: upperSymbol,
    category,
    sector:   fin.sector,
    industry: fin.industry,
    financials: {
      eps:        fin.eps,
      bvps:       fin.bvps,
      ebitdaCr:   fin.ebitdaInCr,
      netDebtCr:  fin.netDebtInCr,
      sharesCr:   fin.sharesInCr,
    },
    band: newBand,
    result,
  })
}
