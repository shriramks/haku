import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { calculateBands, computeTrancheprices, computeTrancheAmounts, trancheSuggestion } from '@/lib/band-calculator'
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

  // Always use live CMP so stale stored values don't push tranches above market price
  let liveCmp: number | null = band.manual_cmp ?? null
  try {
    const cmpRes = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(upperSymbol)}.NS`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (cmpRes.ok) {
      const cmpJson = await cmpRes.json()
      const livePrice: number | undefined = cmpJson?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (livePrice) liveCmp = livePrice
    }
  } catch { /* fall back to stored CMP */ }

  // Preserve allocated tranches — only regenerate unallocated ones
  const { data: existingTranches } = await supabase
    .from('buy_tranches')
    .select('id, allocated, qty, price')
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .eq('fy_id', fyId)

  const allocatedTranches = (existingTranches ?? []).filter(t => t.allocated)
  const allocatedAmt = allocatedTranches.reduce((s, t) => s + t.qty * t.price, 0)
  const remainingAfterAllocated = Math.max(0, remaining - allocatedAmt)

  // Deep zone: CMP below buyLow — deploy only 50%, hold 50% as reserve
  const isDeepZone = !!liveCmp && liveCmp < buyLow
  const deployable = isDeepZone ? remainingAfterAllocated * 0.5 : remainingAfterAllocated

  const totalCapital = fy?.total_budget_inr ?? 0
  const suggestedAmt = trancheSuggestion(deployable, totalCapital)
  const trancheCount = suggestedAmt > 0
    ? Math.min(8, Math.max(2, Math.ceil(deployable / suggestedAmt)))
    : 3
  const prices = computeTrancheprices(buyLow, buyHigh, liveCmp, midLow, midHigh, trancheCount)

  // Sort highest to lowest (index 0 = nearest to market, last = deepest)
  const sortedPrices = [...prices].sort((a, b) => b - a)
  const amounts = computeTrancheAmounts(deployable, sortedPrices.length)

  // Delete only unallocated tranches; keep allocated ones intact
  await supabase.from('buy_tranches')
    .delete()
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .eq('fy_id', fyId)
    .eq('allocated', false)

  const trancheRows = sortedPrices.map((price, i) => {
    const amt = amounts[i] ?? 0
    return {
      user_id:    user.id,
      symbol:     upperSymbol,
      price,
      qty:        amt > 0 ? Math.max(1, Math.round(amt / price)) : 0,
      allocated:  false,
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

  return NextResponse.json({ symbol: upperSymbol, tranches: inserted ?? [] })
}
