import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeTrancheprices } from '@/lib/band-calculator'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()
  const { fyId } = await req.json().catch(() => ({})) as { fyId?: string }

  if (!fyId) return NextResponse.json({ error: 'fyId required' }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch current band for buy zone + CMP
  const { data: band } = await supabase
    .from('buy_bands')
    .select('buy_low, buy_high, manual_cmp')
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .eq('is_current', true)
    .maybeSingle()

  if (!band?.buy_low || !band?.buy_high) {
    return NextResponse.json({
      error: `No bands found for ${upperSymbol}. Generate bands first.`,
    }, { status: 422 })
  }

  // Compute remaining budget for this stock in this FY
  const [{ data: fy }, { data: fyAlloc }, { data: txns }] = await Promise.all([
    supabase.from('fiscal_years').select('total_budget_inr').eq('id', fyId).single(),
    supabase.from('stock_allocations')
      .select('allocation_pct, carryover_inr')
      .eq('user_id', user.id).eq('fy_id', fyId).eq('symbol', upperSymbol)
      .maybeSingle(),
    supabase.from('transactions')
      .select('trade_type, amount')
      .eq('user_id', user.id).eq('symbol', upperSymbol).eq('fy_id', fyId),
  ])

  const allocBudget = (fyAlloc && fy)
    ? (fyAlloc.allocation_pct / 100) * fy.total_budget_inr + (fyAlloc.carryover_inr ?? 0)
    : 0
  const netSpent = (txns ?? []).reduce(
    (s: number, t: { trade_type: string; amount: number }) =>
      s + (t.trade_type === 'buy' ? t.amount : -t.amount), 0)
  const remaining = Math.max(0, allocBudget - netSpent)

  const prices = computeTrancheprices(band.buy_low, band.buy_high, band.manual_cmp ?? null)
  const amtPerTranche = prices.length > 0 ? remaining / prices.length : 0

  // Replace existing tranches for this symbol + FY
  await supabase.from('buy_tranches')
    .delete()
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .eq('fy_id', fyId)

  const trancheRows = prices.map((price, i) => ({
    user_id:    user.id,
    symbol:     upperSymbol,
    price,
    qty:        amtPerTranche > 0 ? Math.max(1, Math.round(amtPerTranche / price)) : 0,
    allocated:  false,
    sort_order: i + 1,
    fy_id:      fyId,
  }))

  const { data: inserted, error } = await supabase
    .from('buy_tranches')
    .insert(trancheRows)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ symbol: upperSymbol, tranches: inserted ?? [] })
}
