import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { calculateBands, computeGrowth, computeTranchePrices, deriveIndexEps, getCostOfEquity } from '@/lib/band-calculator'
import { fetchCmp } from '@/lib/market-data'
import { fetchScreenerData } from '@/lib/screener'
import { fetchNseIndex } from '@/lib/nse'
import type { StockCategory } from '@/lib/types'

type GenerateAction = 'bands' | 'financials'

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()
  const body = await req.json().catch(() => ({})) as { fyId?: string; action?: GenerateAction }
  const fyId = body.fyId ?? null
  const action: GenerateAction = body.action === 'financials' ? 'financials' : 'bands'

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
      .select('id, eps, pat_now, pat_3yr_ago, roce_3yr_avg, mcap, index_level, index_pe, manual_cmp, notes, generated_at, risk_multiplier')
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
  const existingCmp = existingBand?.manual_cmp ?? null

  if (action === 'financials') {
    let eps: number | null = null
    let asOf = ''
    let indexLevel: number | null = null
    let indexPE: number | null = null
    let patNow: number | null = null
    let pat3yrAgo: number | null = null
    let roce3yrAvg: number | null = null
    let mcap: number | null = null

    try {
      if (isIndex) {
        const indexName = category === 'Nifty 50 Index' ? 'NIFTY 50' : 'NIFTY NEXT 50'
        const data = await fetchNseIndex(indexName)
        indexLevel = data.level
        indexPE    = data.pe
        asOf       = data.asOf
        eps        = deriveIndexEps(indexLevel, indexPE)
      } else {
        const data = await fetchScreenerData(upperSymbol)
        eps        = data.eps
        patNow     = data.patNow
        pat3yrAgo  = data.pat3yrAgo
        roce3yrAvg = data.roce3yrAvg
        mcap       = data.mcap
        asOf       = data.asOf
      }
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
      manual_cmp: existingCmp,
      notes: asOf,
      last_updated_at: now,
      generated_at: existingBand?.generated_at ?? now,
    }

    if (isIndex) {
      payload.index_level = indexLevel
      payload.index_pe = indexPE
    } else {
      payload.pat_now = patNow
      payload.pat_3yr_ago = pat3yrAgo
      payload.roce_3yr_avg = roce3yrAvg
      payload.mcap = mcap
    }

    const { data: savedBand, error } = await supabase
      .from('buy_bands')
      .upsert(payload, { onConflict: 'user_id,symbol' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    revalidateTag('buy_bands', {})

    return NextResponse.json({
      symbol: upperSymbol,
      category,
      mode: action,
      financials: isIndex
        ? { eps, indexLevel, indexPE, asOf }
        : { eps, patNow, pat3yrAgo, roce3yrAvg, mcap, g: computeGrowth(patNow, pat3yrAgo), ke, asOf },
      band: savedBand,
    })
  }

  const eps = isIndex
    ? deriveIndexEps(existingBand?.index_level ?? null, existingBand?.index_pe ?? null)
    : (existingBand?.eps ?? null)
  const patNow = existingBand?.pat_now ?? null
  const pat3yrAgo = existingBand?.pat_3yr_ago ?? null
  const roce3yrAvg = existingBand?.roce_3yr_avg ?? null
  const mcap = existingBand?.mcap ?? null
  const indexLevel = existingBand?.index_level ?? null
  const indexPE = existingBand?.index_pe ?? null
  const g = computeGrowth(patNow, pat3yrAgo)

  if (!eps || (!isIndex && (patNow == null || pat3yrAgo == null || roce3yrAvg == null || mcap == null))) {
    return NextResponse.json({
      error: `No saved financials for ${upperSymbol}. Use Regen Financials first.`,
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
    manual_cmp: existingCmp,
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

  let generatedTranches: unknown[] = []

  if (fyId) {
    const [{ data: fy }, { data: fyAlloc }, { data: txns }] = await Promise.all([
      supabase.from('fiscal_years').select('total_budget_inr, unallocated_carryover_inr').eq('id', fyId).single(),
      supabase.from('stock_allocations')
        .select('allocation_pct')
        .eq('user_id', user.id).eq('fy_id', fyId).eq('symbol', upperSymbol)
        .maybeSingle(),
      supabase.from('transactions')
        .select('trade_type, amount')
        .eq('user_id', user.id).eq('symbol', upperSymbol).eq('fy_id', fyId),
    ])

    const allocBudget = (fyAlloc && fy)
      ? (fyAlloc.allocation_pct / 100) * (fy.total_budget_inr + (fy.unallocated_carryover_inr ?? 0))
      : 0
    const netSpent = (txns ?? []).reduce(
      (s: number, t: { trade_type: string; amount: number }) =>
        s + (t.trade_type === 'buy' ? t.amount : -t.amount), 0)
    const remaining = Math.max(0, allocBudget - netSpent)
    const liveCmp: number | null = (await fetchCmp(upperSymbol)) ?? existingCmp
    const rm = existingBand?.risk_multiplier ?? 1
    const prices = computeTranchePrices(result.buyLow * rm, result.buyHigh * rm, liveCmp)
    const amtPerTranche = prices.length > 0 ? remaining / prices.length : 0

    await supabase.from('buy_tranches')
      .delete()
      .eq('user_id', user.id)
      .eq('symbol', upperSymbol)
      .eq('fy_id', fyId)

    const trancheRows = prices.map((price, i) => ({
      user_id: user.id,
      symbol: upperSymbol,
      price,
      qty: amtPerTranche > 0 ? Math.max(1, Math.round(amtPerTranche / price)) : 0,
      sort_order: i + 1,
      fy_id: fyId,
    }))

    const { data: inserted } = await supabase
      .from('buy_tranches')
      .insert(trancheRows)
      .select()

    generatedTranches = inserted ?? []
  }

  revalidateTag('buy_bands', {})
  revalidateTag('buy_tranches', {})

  return NextResponse.json({
    symbol: upperSymbol,
    category,
    mode: action,
    financials: isIndex
      ? { eps, indexLevel, indexPE, asOf: existingBand?.notes ?? '' }
      : { eps, patNow, pat3yrAgo, roce3yrAvg, mcap, g, ke, asOf: existingBand?.notes ?? '' },
    band: newBand,
    result,
    tranches: generatedTranches,
  })
}
