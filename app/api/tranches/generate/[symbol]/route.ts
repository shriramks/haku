import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { calculateBands, computeTrancheprices, computeTrancheAmounts, trancheSuggestion, INDEX_CATEGORIES } from '@/lib/band-calculator'
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

  // Fetch allocation (category + qualifier flags) and current band (financials + CMP)
  const [{ data: alloc }, { data: band }] = await Promise.all([
    supabase.from('stock_allocations')
      .select('category, two_weak_quarters, two_strong_quarters')
      .eq('user_id', user.id).eq('fy_id', fyId).eq('symbol', upperSymbol)
      .maybeSingle(),
    supabase.from('buy_bands')
      .select('buy_low, buy_high, manual_cmp, mid_low, mid_high, eps, bvps, ebitda, net_debt, shares, embedded_value')
      .eq('user_id', user.id).eq('symbol', upperSymbol).eq('is_current', true)
      .maybeSingle(),
  ])

  if (!band?.buy_low || !band?.buy_high) {
    return NextResponse.json({
      error: `No bands found for ${upperSymbol}. Generate bands first.`,
    }, { status: 422 })
  }

  // Recompute bands live from current allocation category + stored financials.
  // This ensures tranches reflect any category change since the last band generation.
  const freshResult = alloc?.category ? calculateBands({
    category: alloc.category as StockCategory,
    twoWeakQuarters:   alloc.two_weak_quarters   ?? false,
    twoStrongQuarters: alloc.two_strong_quarters  ?? false,
    eps:           band.eps,
  }) : null

  const buyLow  = freshResult?.buyLow  ?? band.buy_low
  const buyHigh = freshResult?.buyHigh ?? band.buy_high
  const midLow  = freshResult?.midLow  ?? band.mid_low  ?? band.buy_high
  const midHigh = freshResult?.midHigh ?? band.mid_high ?? band.buy_high

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
      .or(`fy_id.eq.${fyId},advance_fy_id.eq.${fyId}`),
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

  // Fetch 1-year daily chart: gives live CMP (from meta) + 52-week low (from daily lows)
  let liveCmp: number | null = band.manual_cmp ?? null
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

  const deployable = remaining

  const totalCapital = fy?.total_budget_inr ?? 0
  const suggestedAmt = trancheSuggestion(deployable, totalCapital)
  const trancheCount = suggestedAmt > 0
    ? Math.min(8, Math.max(2, Math.ceil(deployable / suggestedAmt)))
    : 3
  const isIndex     = alloc?.category ? INDEX_CATEGORIES.has(alloc.category as StockCategory) : false
  const isAboveZone = liveCmp !== null && liveCmp > buyHigh
  const isDeepZone  = liveCmp !== null && liveCmp < buyLow
  const prices = computeTrancheprices(buyLow, buyHigh, liveCmp, midLow, midHigh, trancheCount, fiftyTwoWeekLow, isIndex)

  // Sort highest to lowest (index 0 = nearest to market, last = deepest)
  const sortedPrices = [...prices].sort((a, b) => b - a)
  // Equal split when CMP is outside the buy zone — probability of any given tranche
  // filling is too uncertain to over-weight the deepest one.
  // Conviction-weighting (bottom-heavy) applies only inside the zone (Case B).
  const amounts = computeTrancheAmounts(deployable, sortedPrices.length, isAboveZone || isDeepZone)

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
    _debug: { buyLow, buyHigh, liveCmp, fiftyTwoWeekLow, deployable, trancheCount },
  })
}
