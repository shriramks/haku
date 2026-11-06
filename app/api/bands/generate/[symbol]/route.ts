import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { calculateBands, checkBandReadiness, deriveBandInputs, getCostOfEquity, isIndexCategory } from '@/lib/band-calculator'
import { fetchScreenerData } from '@/lib/screener'
import { fiscalQuarterLabel } from '@/lib/fy-utils'
import { generateTranchesForSymbol } from '@/lib/tranche-pipeline'
import { buildBandsPayload, buildFinancialsPayload, resolveIndexState, type StoredBand } from '@/lib/band-generate'
import { saveSnapshotIfChanged } from '@/app/actions'
import type { StockCategory } from '@/lib/types'

type GenerateAction = 'bands' | 'financials'
type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

interface Ctx {
  supabase: Supabase
  userId: string
  symbol: string
  category: StockCategory
  isIndex: boolean
  ke: number
  existingBand: (StoredBand & { id: string }) | null
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

// ── `financials`: fetch raw inputs from Screener, store them, snapshot ───────────────────────

async function runFinancials(c: Ctx) {
  // Index ETFs have no separate financials fetch — their CMP+PE are pulled fresh
  // by the 'bands' action, and manual edits recompute via FinancialsSheet save.
  if (c.isIndex) return fail('Index ETFs have no separate financials step — use Regen Bands.', 400)

  let data: Awaited<ReturnType<typeof fetchScreenerData>>
  try {
    data = await fetchScreenerData(c.symbol)
  } catch (e: unknown) {
    return fail(`Failed to fetch financials: ${e instanceof Error ? e.message : String(e)}`, 502)
  }

  if (!data.eps) {
    return fail(`Not enough data to save financials for ${c.symbol}. Got: EPS=${data.eps}`, 422)
  }

  const payload = buildFinancialsPayload(c.userId, c.symbol, { ...data, eps: data.eps }, c.existingBand, new Date().toISOString())
  const { data: savedBand, error } = await c.supabase
    .from('buy_bands')
    .upsert(payload, { onConflict: 'user_id,symbol' })
    .select()
    .single()
  if (error) return fail(error.message, 500)

  revalidateTag('buy_bands', {})

  const { g, snapshot } = deriveBandInputs(c.category, data)
  if (snapshot) await saveSnapshotIfChanged(c.symbol, snapshot, fiscalQuarterLabel(new Date()))

  return NextResponse.json({
    symbol: c.symbol,
    category: c.category,
    mode: 'financials' as const,
    financials: { eps: data.eps, patNow: data.patNow, pat3yrAgo: data.pat3yrAgo, roce3yrAvg: data.roce3yrAvg, mcap: data.mcap, g, ke: c.ke, asOf: data.asOf },
    band: savedBand,
  })
}

// ── `bands`: compute prices from the stored inputs, store, regenerate tranches ───────────────

async function runBands(c: Ctx, fyId: string | null, refetch: boolean) {
  const { existingBand } = c

  // Index bands fetch fresh CMP+PE by default; manual recompute (FinancialsSheet
  // save) passes refetch:false to recompute from the stored/edited values instead.
  let index
  try {
    index = await resolveIndexState(c.category, c.symbol, existingBand, c.isIndex && refetch, c.userId)
  } catch (e: unknown) {
    return fail(`Failed to fetch index data: ${e instanceof Error ? e.message : String(e)}`, 502)
  }

  const stored = {
    pat_now: existingBand?.pat_now ?? null,
    pat_3yr_ago: existingBand?.pat_3yr_ago ?? null,
    roce_3yr_avg: existingBand?.roce_3yr_avg ?? null,
    mcap: existingBand?.mcap ?? null,
    cmp: existingBand?.cmp ?? null,
    notes: existingBand?.notes ?? null,
  }
  const eps = c.isIndex ? index.indexEps : (existingBand?.eps ?? null)

  const notReady = checkBandReadiness(c.symbol, c.category, {
    eps, patNow: stored.pat_now, pat3yrAgo: stored.pat_3yr_ago, roce3yrAvg: stored.roce_3yr_avg, mcap: stored.mcap, cmp: stored.cmp,
  })
  if (notReady || !eps) return fail(notReady ?? `Not enough saved data to compute bands for ${c.symbol}.`, 422)

  const { g, growthSource } = deriveBandInputs(c.category, {
    patNow: stored.pat_now, pat3yrAgo: stored.pat_3yr_ago, roce3yrAvg: stored.roce_3yr_avg, opProfitCr: null, revenueCr: null,
  })
  const result = calculateBands({ category: c.category, eps, g, ke: c.ke, mcap: stored.mcap, roce3yrAvg: stored.roce_3yr_avg })
  if (!result) return fail(`Not enough saved data to compute bands for ${c.symbol}.`, 422)

  const payload = buildBandsPayload({ userId: c.userId, symbol: c.symbol, isIndex: c.isIndex, eps, stored, index, result, now: new Date().toISOString() })
  const { data: newBand, error: upsertError } = await c.supabase
    .from('buy_bands')
    .upsert(payload, { onConflict: 'user_id,symbol' })
    .select()
    .single()
  if (upsertError) return fail(upsertError.message, 500)

  // Regenerate buy levels through the shared pipeline so they reflect the bands
  // just computed (the pipeline re-reads the upserted row). Blocked or failed
  // generation is non-fatal here — the band regen itself succeeded.
  let generatedTranches: unknown[] = []
  if (fyId) {
    const gen = await generateTranchesForSymbol(c.supabase, c.userId, c.symbol, fyId)
    if (gen.ok && !gen.blocked) generatedTranches = gen.tranches
  }

  revalidateTag('buy_bands', {})

  const asOf = existingBand?.notes ?? ''
  return NextResponse.json({
    symbol: c.symbol,
    category: c.category,
    mode: 'bands' as const,
    financials: c.isIndex
      ? { eps, indexLevel: index.indexLevel, indexPE: index.indexPE, asOf }
      : { eps, patNow: stored.pat_now, pat3yrAgo: stored.pat_3yr_ago, roce3yrAvg: stored.roce_3yr_avg, mcap: stored.mcap, g, growthSource, ke: c.ke, asOf },
    band: newBand,
    result,
    tranches: generatedTranches,
  })
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()
  const body = await req.json().catch(() => ({})) as { fyId?: string; action?: GenerateAction; refetch?: boolean }
  const action: GenerateAction = body.action === 'financials' ? 'financials' : 'bands'

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail('Unauthorized', 401)

  const [{ data: userSettings }, { data: alloc }, { data: existingBand }] = await Promise.all([
    supabase.from('user_settings').select('risk_free').eq('user_id', user.id).maybeSingle(),
    supabase.from('stock_allocations').select('category').eq('user_id', user.id).eq('symbol', upperSymbol).limit(1).single(),
    supabase
      .from('buy_bands')
      .select('id, eps, pat_now, pat_3yr_ago, op_profit_cr, revenue_cr, roce_3yr_avg, mcap, index_level, index_pe, cmp, notes, generated_at')
      .eq('user_id', user.id)
      .eq('symbol', upperSymbol)
      .maybeSingle(),
  ])

  if (!alloc?.category) return fail(`${upperSymbol} not found in your allocations. Add it to a plan first.`, 422)

  const category = alloc.category as StockCategory
  const ctx: Ctx = {
    supabase,
    userId: user.id,
    symbol: upperSymbol,
    category,
    isIndex: isIndexCategory(category),
    ke: getCostOfEquity(userSettings?.risk_free ?? 0.07),
    existingBand,
  }

  return action === 'financials' ? runFinancials(ctx) : runBands(ctx, body.fyId ?? null, body.refetch !== false)
}
