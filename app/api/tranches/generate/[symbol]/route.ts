import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeTranchePrices, computeTrancheAmounts, stagedDeepCmp, INDEX_CATEGORIES, convictionMatrix } from '@/lib/band-calculator'
import { computeSnowball } from '@/lib/snowball'
import type { StockCategory } from '@/lib/types'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()
  const { fyId, remainingInr } = await req.json().catch(() => ({})) as { fyId?: string; remainingInr?: number }

  if (!fyId) return NextResponse.json({ error: 'fyId required' }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch allocation (category) and current band (stored computed values + CMP)
  const [{ data: fyAllocMeta }, { data: band, error: bandError }, { data: snapshots }] = await Promise.all([
    supabase.from('stock_allocations')
      .select('category')
      .eq('user_id', user.id).eq('fy_id', fyId).eq('symbol', upperSymbol)
      .maybeSingle(),
    supabase.from('buy_bands')
      .select('buy_low, buy_high, manual_cmp, mid_low, mid_high, trim_price')
      .eq('user_id', user.id).eq('symbol', upperSymbol)
      .maybeSingle(),
    supabase.from('buy_band_snapshots')
      .select('g_computed, op_margin')
      .eq('user_id', user.id).eq('symbol', upperSymbol)
      .order('snapshotted_at', { ascending: false })
      .limit(2),
  ])

  if (bandError) return NextResponse.json({ error: `buy_bands query failed: ${bandError.message}` }, { status: 500 })

  // If current FY's allocation has no category, fall back to any FY for this symbol.
  let alloc = fyAllocMeta
  if (!alloc?.category) {
    const { data: anyAlloc } = await supabase
      .from('stock_allocations')
      .select('category')
      .eq('user_id', user.id).eq('symbol', upperSymbol)
      .not('category', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (anyAlloc?.category) alloc = { ...anyAlloc, ...fyAllocMeta }
  }

  // Use stored band values — bands are only recomputed on Regen Bands.
  const buyLow  = band?.buy_low  ?? null
  const buyHigh = band?.buy_high ?? null
  const midLow  = band?.mid_low  ?? band?.buy_high ?? null
  const midHigh = band?.mid_high ?? band?.buy_high ?? null

  if (!buyLow || !buyHigh) {
    const why = !band
      ? 'no buy_bands row found — run Regen Bands first'
      : !alloc
        ? `no stock_allocations row found for fy_id=${fyId}`
        : !alloc.category
          ? 'category not set on this allocation row'
          : 'bands not set — run Regen Bands to compute'
    return NextResponse.json({
      error: `Cannot generate tranches for ${upperSymbol}: ${why}`,
    }, { status: 422 })
  }

  // Compute remaining budget for this stock in this FY
  const [{ data: fy }, { data: fyAlloc }, { data: txns }] = await Promise.all([
    supabase.from('fiscal_years').select('total_budget_inr, unallocated_carryover_inr').eq('id', fyId).single(),
    supabase.from('stock_allocations')
      .select('allocation_pct')
      .eq('user_id', user.id).eq('fy_id', fyId).eq('symbol', upperSymbol)
      .maybeSingle(),
    supabase.from('transactions')
      .select('trade_type, amount')
      .eq('user_id', user.id).eq('symbol', upperSymbol)
      .eq('fy_id', fyId),
  ])

  // If the client passes remainingInr, use it directly — it already includes per-stock
  // carryover adjustments that the server-side calculation would miss.
  let remaining: number
  if (remainingInr != null) {
    remaining = Math.max(0, remainingInr)
  } else {
    const allocBudget = (fyAlloc && fy)
      ? (fyAlloc.allocation_pct / 100) * (fy.total_budget_inr + (fy.unallocated_carryover_inr ?? 0))
      : 0
    const netSpent = (txns ?? []).reduce(
      (s: number, t: { trade_type: string; amount: number }) =>
        s + (t.trade_type === 'buy' ? t.amount : -t.amount), 0)
    remaining = Math.max(0, allocBudget - netSpent)
  }

  // Fetch all-time buy transactions for this symbol — used for staged buy pricing
  const { data: allSymbolBuys } = await supabase
    .from('transactions')
    .select('price')
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .eq('trade_type', 'buy')

  const minBuyPrice = allSymbolBuys && allSymbolBuys.length > 0
    ? Math.min(...allSymbolBuys.map((t: { price: number }) => t.price))
    : null

  // Fetch 1-year daily chart: gives live CMP (from meta) + 52-week low (from daily lows)
  let liveCmp: number | null = band?.manual_cmp ?? null
  let fiftyTwoWeekLow: number | null = null
  try {
    const cmpRes = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(upperSymbol)}.NS?range=1y&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (cmpRes.ok) {
      const cmpJson = await cmpRes.json()
      const result = cmpJson?.chart?.result?.[0]
      const livePrice: number | undefined = result?.meta?.regularMarketPrice
      if (livePrice) liveCmp = livePrice
      const dailyLows: (number | null)[] = result?.indicators?.quote?.[0]?.low ?? []
      const validLows = dailyLows.filter((n): n is number => n != null && n > 0)
      if (validLows.length > 0) fiftyTwoWeekLow = Math.min(...validLows)
    }
  } catch { /* fall back to stored CMP, no 52-week low */ }

  // Staged buy: in deep value zone, cap effective CMP below the user's cheapest prior entry.
  const stagedCmp = stagedDeepCmp(liveCmp, buyLow, minBuyPrice)

  const deployable = remaining
  const isIndex = alloc?.category ? INDEX_CATEGORIES.has(alloc.category as StockCategory) : false

  // Compute Snowball signal from stored snapshots and live CMP
  const snap0 = snapshots?.[0] ?? null
  const snap1 = snapshots?.[1] ?? null
  const trimPrice = band?.trim_price ?? null
  const snowball = (liveCmp && trimPrice && midLow && midHigh)
    ? computeSnowball({
        cmp: liveCmp,
        buyLow, buyHigh,
        midLow, midHigh,
        trim: trimPrice,
        g: snap0?.g_computed ?? null,
        opMarginNow: snap0?.op_margin ?? null,
        gPrior: snap1?.g_computed ?? null,
        opMarginPrior: snap1?.op_margin ?? null,
      })
    : null

  const conviction = snowball
    ? convictionMatrix(snowball.zone, snowball.signal, buyLow, buyHigh)
    : convictionMatrix('BUY', 'INSUFFICIENT_DATA', buyLow, buyHigh)

  if (conviction.trancheCount === 0) {
    return NextResponse.json({
      symbol: upperSymbol,
      tranches: [],
      blocked: true,
      reason: `No tranches generated — stock is in ${snowball?.zone ?? 'mid/watch'} zone`,
    })
  }

  const prices = computeTranchePrices(
    buyLow, buyHigh, stagedCmp, conviction.trancheCount,
    fiftyTwoWeekLow, isIndex, conviction.ceilingOverride, conviction.deepExtension,
  )

  // Sort highest to lowest (index 0 = nearest to market, last = deepest)
  const sortedPrices = [...prices].sort((a, b) => b - a)

  // Anchor: if a recent buy price falls within the generated range, pin one slot
  // there so prior demand level is represented.
  if (sortedPrices.length >= 2 && allSymbolBuys && allSymbolBuys.length > 0) {
    const priceMin = sortedPrices[sortedPrices.length - 1]
    const priceMax = sortedPrices[0]
    const snap = (p: number) => { const u = p < 500 ? 5 : 10; return Math.round(p / u) * u }
    const anchorRaw = (allSymbolBuys as { price: number }[])
      .map(t => t.price)
      .filter(p => p >= priceMin && p <= priceMax)
      .sort((a, b) => b - a)[0]
    if (anchorRaw != null) {
      const anchor = snap(anchorRaw)
      const minUnit = anchor < 500 ? 5 : 10
      const alreadyCovered = sortedPrices.some(p => Math.abs(p - anchor) <= minUnit)
      if (!alreadyCovered) {
        const closestIdx = sortedPrices.reduce((best, p, i) =>
          Math.abs(p - anchor) < Math.abs(sortedPrices[best] - anchor) ? i : best, 0)
        sortedPrices[closestIdx] = anchor
        sortedPrices.sort((a, b) => b - a)
      }
    }
  }

  const amounts = computeTrancheAmounts(deployable, sortedPrices.length, conviction.weightMode)

  await supabase.from('buy_tranches')
    .delete()
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .eq('fy_id', fyId)

  const trancheRows = sortedPrices.map((price, i) => {
    const amt = amounts[i] ?? 0
    return {
      user_id:    user.id,
      symbol:     upperSymbol,
      price,
      qty:        amt > 0 ? Math.max(1, Math.round(amt / price)) : 0,
      sort_order: i + 1,
      fy_id:      fyId,
    }
  })

  const { data: inserted, error } = await supabase
    .from('buy_tranches')
    .insert(trancheRows)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateTag('buy_tranches', {})

  // Reachability warning: flag if >50% of tranches are >15% below CMP
  const farCount = liveCmp
    ? sortedPrices.filter(p => (liveCmp! - p) / liveCmp! > 0.15).length
    : 0
  const warning = liveCmp && farCount > sortedPrices.length / 2
    ? '⚠️ Majority of capital parked >15% below CMP. Review whether deployment timing is appropriate.'
    : null

  return NextResponse.json({
    symbol: upperSymbol,
    tranches: inserted ?? [],
    warning,
    _debug: { buyLow, buyHigh, liveCmp, stagedCmp, minBuyPrice, fiftyTwoWeekLow, deployable, conviction, zone: snowball?.zone, signal: snowball?.signal },
  })
}
