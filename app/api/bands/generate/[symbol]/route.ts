import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { calculateBands, computeGrowth, computeHospitalGrowth, deriveIndexEps, getCostOfEquity } from '@/lib/band-calculator'
import { fetchScreenerData } from '@/lib/screener'
import { fetchNseIndex } from '@/lib/nse'
import { fetchCmp } from '@/lib/market-data'
import { fiscalQuarterLabel } from '@/lib/fy-utils'
import { generateTranchesForSymbol } from '@/lib/tranche-pipeline'
import { saveSnapshotIfChanged } from '@/app/actions'
import type { StockCategory } from '@/lib/types'

type GenerateAction = 'bands' | 'financials'

const INDEX_NAME: Partial<Record<StockCategory, string>> = {
  'Nifty 50 Index': 'NIFTY 50',
  'Nifty Next 50 Index': 'NIFTY NEXT 50',
}

interface IndexInputs { level: number; pe: number; cmp: number; eps: number }

// Fetch a fresh, consistent (CMP, PE) pair for an index ETF and derive eps = cmp/pe.
// fetchNseIndex keys on the index name (from category); fetchCmp keys on the ETF
// ticker (the allocation symbol). Both read in one moment so the stored band, eps,
// and cmp stay mutually consistent — that consistency is what makes the rupee-band
// zone test reduce exactly to a PE comparison.
async function fetchIndexInputs(category: StockCategory, symbol: string): Promise<IndexInputs> {
  const indexName = INDEX_NAME[category]
  if (!indexName) throw new Error(`No NSE index mapping for category "${category}"`)
  const [idx, cmp] = await Promise.all([fetchNseIndex(indexName), fetchCmp(symbol)])
  if (cmp == null) throw new Error(`No CMP available for ${symbol}`)
  const eps = deriveIndexEps(cmp, idx.pe)
  if (eps == null) throw new Error(`Cannot derive index eps for ${symbol} (cmp=${cmp}, pe=${idx.pe})`)
  return { level: idx.level, pe: idx.pe, cmp, eps }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()
  const body = await req.json().catch(() => ({})) as { fyId?: string; action?: GenerateAction; refetch?: boolean }
  const fyId = body.fyId ?? null
  const action: GenerateAction = body.action === 'financials' ? 'financials' : 'bands'
  // Index bands fetch fresh CMP+PE by default; manual recompute (FinancialsSheet
  // save) passes refetch:false to recompute from the stored/edited values instead.
  const refetch = body.refetch !== false

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: userSettings }, { data: alloc }, { data: existingBand }] = await Promise.all([
    supabase
      .from('user_settings')
      .select('risk_free')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('stock_allocations')
      .select('category')
      .eq('user_id', user.id)
      .eq('symbol', upperSymbol)
      .limit(1)
      .single(),
    supabase
      .from('buy_bands')
      .select('id, eps, pat_now, pat_3yr_ago, op_profit_cr, revenue_cr, roce_3yr_avg, mcap, index_level, index_pe, cmp, notes, generated_at')
      .eq('user_id', user.id)
      .eq('symbol', upperSymbol)
      .maybeSingle(),
  ])

  if (!alloc?.category) {
    return NextResponse.json({
      error: `${upperSymbol} not found in your allocations. Add it to a plan first.`,
    }, { status: 422 })
  }

  const category = alloc.category as StockCategory
  const isIndex = category === 'Nifty 50 Index' || category === 'Nifty Next 50 Index'
  const riskFree = userSettings?.risk_free ?? 0.07
  const ke = getCostOfEquity(riskFree)
  const existingCmp = existingBand?.cmp ?? null

  if (action === 'financials') {
    // Index ETFs have no separate financials fetch — their CMP+PE are pulled fresh
    // by the 'bands' action, and manual edits recompute via FinancialsSheet save.
    if (isIndex) {
      return NextResponse.json({
        error: 'Index ETFs have no separate financials step — use Regen Bands.',
      }, { status: 400 })
    }

    let eps: number | null = null
    let asOf = ''
    let patNow: number | null = null
    let pat3yrAgo: number | null = null
    let roce3yrAvg: number | null = null
    let mcap: number | null = null
    let opProfitCr: number | null = null
    let revenueCr: number | null = null

    try {
      const data = await fetchScreenerData(upperSymbol)
      eps        = data.eps
      patNow     = data.patNow
      pat3yrAgo  = data.pat3yrAgo
      roce3yrAvg = data.roce3yrAvg
      mcap       = data.mcap
      asOf       = data.asOf
      opProfitCr = data.opProfitCr
      revenueCr  = data.revenueCr
    } catch (e: unknown) {
      return NextResponse.json({
        error: `Failed to fetch financials: ${e instanceof Error ? e.message : String(e)}`,
      }, { status: 502 })
    }

    if (!eps) {
      return NextResponse.json({
        error: `Not enough data to save financials for ${upperSymbol}. Got: EPS=${eps}`,
      }, { status: 422 })
    }

    const now = new Date().toISOString()
    const payload: Record<string, unknown> = {
      user_id: user.id,
      symbol: upperSymbol,
      anchor_type: 'PE',
      eps,
      cmp: existingCmp,
      notes: asOf,
      last_updated_at: now,
      generated_at: existingBand?.generated_at ?? now,
      pat_now: patNow,
      pat_3yr_ago: pat3yrAgo,
      roce_3yr_avg: roce3yrAvg,
      mcap,
      op_profit_cr: opProfitCr,
      revenue_cr: revenueCr,
    }

    const { data: savedBand, error } = await supabase
      .from('buy_bands')
      .upsert(payload, { onConflict: 'user_id,symbol' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    revalidateTag('buy_bands', {})

    if (patNow != null && pat3yrAgo != null) {
      const g = category === 'Hospitals'
        ? computeHospitalGrowth(patNow, pat3yrAgo, roce3yrAvg).g
        : computeGrowth(patNow, pat3yrAgo)
      const opMargin = (opProfitCr != null && revenueCr != null && revenueCr !== 0)
        ? opProfitCr / revenueCr
        : null
      const autoLabel = fiscalQuarterLabel(new Date())
      await saveSnapshotIfChanged(upperSymbol, {
        pat_now: patNow,
        pat_3yr_ago: pat3yrAgo,
        op_profit_cr: opProfitCr,
        revenue_cr: revenueCr,
        g_computed: g,
        op_margin: opMargin,
      }, autoLabel)
    }

    return NextResponse.json({
      symbol: upperSymbol,
      category,
      mode: action,
      financials: { eps, patNow, pat3yrAgo, roce3yrAvg, mcap,
        g: category === 'Hospitals'
          ? computeHospitalGrowth(patNow, pat3yrAgo, roce3yrAvg).g
          : computeGrowth(patNow, pat3yrAgo),
        ke, asOf },
      band: savedBand,
    })
  }

  // Index ETFs: refetch a fresh, consistent (CMP, PE) pair unless this is a manual
  // recompute (refetch=false), where we recompute from the stored/edited values.
  // The stored cmp must equal the cmp baked into eps, else the rupee-band zone test
  // no longer reduces exactly to a PE comparison.
  let indexLevel = existingBand?.index_level ?? null
  let indexPE = existingBand?.index_pe ?? null
  let indexCmp = existingCmp
  let indexEps: number | null = deriveIndexEps(existingCmp, indexPE)
  if (isIndex && refetch) {
    try {
      const idx = await fetchIndexInputs(category, upperSymbol)
      indexLevel = idx.level
      indexPE    = idx.pe
      indexCmp   = idx.cmp
      indexEps   = idx.eps
    } catch (e: unknown) {
      return NextResponse.json({
        error: `Failed to fetch index data: ${e instanceof Error ? e.message : String(e)}`,
      }, { status: 502 })
    }
  }

  const eps = isIndex ? indexEps : (existingBand?.eps ?? null)
  const patNow = existingBand?.pat_now ?? null
  const pat3yrAgo = existingBand?.pat_3yr_ago ?? null
  const roce3yrAvg = existingBand?.roce_3yr_avg ?? null
  const mcap = existingBand?.mcap ?? null
  const { g, growthSource } = category === 'Hospitals'
    ? computeHospitalGrowth(patNow, pat3yrAgo, roce3yrAvg)
    : { g: computeGrowth(patNow, pat3yrAgo), growthSource: 'calculated_3y_pat_cagr' as const }

  if (!eps || (!isIndex && (patNow == null || pat3yrAgo == null || roce3yrAvg == null || mcap == null))) {
    return NextResponse.json({
      error: isIndex
        ? `Missing CMP/PE for ${upperSymbol}. Run Regen Bands to fetch fresh index data.`
        : `No saved financials for ${upperSymbol}. Use Regen Financials first.`,
    }, { status: 422 })
  }

  if (category === 'Hospitals' && existingCmp && eps && existingCmp / eps > 80) {
    return NextResponse.json({
      error: `PE unreliable (${Math.round(existingCmp / eps)}×) — EV/EBITDA override needed for ${upperSymbol}`,
    }, { status: 422 })
  }

  const result = calculateBands({
    category,
    eps,
    g,
    ke,
    mcap,
    roce3yrAvg,
  })

  if (!result) {
    return NextResponse.json({
      error: `Not enough saved data to compute bands for ${upperSymbol}.`,
    }, { status: 422 })
  }

  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    user_id: user.id,
    symbol: upperSymbol,
    anchor_type: 'PE',
    eps,
    pat_now: patNow,
    pat_3yr_ago: pat3yrAgo,
    roce_3yr_avg: roce3yrAvg,
    mcap,
    index_level: indexLevel,
    index_pe: indexPE,
    buy_low: result.buyLow,
    buy_high: result.buyHigh,
    mid_low: result.midLow,
    mid_high: result.midHigh,
    trim_price: result.trimPrice,
    cmp: isIndex ? indexCmp : existingCmp,
    notes: existingBand?.notes ?? '',
    last_updated_at: now,
    generated_at: now,
  }

  const { data: newBand, error: upsertError } = await supabase
    .from('buy_bands')
    .upsert(payload, { onConflict: 'user_id,symbol' })
    .select()
    .single()

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 })

  // Regenerate buy levels through the shared pipeline so they reflect the bands
  // just computed (the pipeline re-reads the upserted row). Blocked or failed
  // generation is non-fatal here — the band regen itself succeeded.
  let generatedTranches: unknown[] = []

  if (fyId) {
    const gen = await generateTranchesForSymbol(supabase, user.id, upperSymbol, fyId)
    if (gen.ok && !gen.blocked) generatedTranches = gen.tranches
  }

  revalidateTag('buy_bands', {})

  return NextResponse.json({
    symbol: upperSymbol,
    category,
    mode: action,
    financials: isIndex
      ? { eps, indexLevel, indexPE, asOf: existingBand?.notes ?? '' }
      : { eps, patNow, pat3yrAgo, roce3yrAvg, mcap, g, growthSource, ke, asOf: existingBand?.notes ?? '' },
    band: newBand,
    result,
    tranches: generatedTranches,
  })
}
