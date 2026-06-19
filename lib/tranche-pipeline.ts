// Buy-level (tranche) generation pipeline — the single implementation shared by
// the Buy Levels route (/api/tranches/generate) and Regen Bands
// (/api/bands/generate). Every step — risk overlay, snowball, conviction matrix,
// staged-deep cap, 52-week floor, weighted amounts, anchor pinning — runs
// identically for both entry points; never re-implement a subset at a call site.

import { revalidateTag } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeTranchePrices, computeTrancheAmounts, stagedDeepCmp, snapPrice, snapUnit,
  INDEX_CATEGORIES, convictionMatrix, effectiveBands,
} from './band-calculator'
import { computeSnowball } from './snowball'
import { fetchYearChart } from './market-data'
import type { BuyTranche, StockCategory } from './types'

export type TrancheGenResult =
  | { ok: false; status: number; error: string }
  | { ok: true; blocked: true; reason: string }
  | { ok: true; blocked: false; tranches: BuyTranche[]; warning: string | null; debug: Record<string, unknown> }

/**
 * Regenerates buy tranches for a symbol in a FY: deletes the existing rows and
 * inserts the new plan, then revalidates the buy_tranches cache tag.
 *
 * `remainingInr`, when provided by the client, is used as the deployable budget
 * directly — it already includes per-stock carryover adjustments the server-side
 * calculation would miss. Otherwise remaining = allocation budget − FY net spend.
 *
 * Blocked outcomes (mid/watch/trim zone) make no DB changes.
 */
export async function generateTranchesForSymbol(
  supabase: SupabaseClient,
  userId: string,
  upperSymbol: string,
  fyId: string,
  remainingInr?: number | null,
): Promise<TrancheGenResult> {
  // Fetch allocation (category) and current band (stored computed values + CMP)
  const [{ data: fyAllocMeta }, { data: band, error: bandError }, { data: snapshots }] = await Promise.all([
    supabase.from('stock_allocations')
      .select('category')
      .eq('user_id', userId).eq('fy_id', fyId).eq('symbol', upperSymbol)
      .maybeSingle(),
    supabase.from('buy_bands')
      .select('buy_low, buy_high, cmp, mid_low, mid_high, trim_price, risk_multiplier')
      .eq('user_id', userId).eq('symbol', upperSymbol)
      .maybeSingle(),
    supabase.from('buy_band_snapshots')
      .select('g_computed, op_margin')
      .eq('user_id', userId).eq('symbol', upperSymbol)
      .order('snapshotted_at', { ascending: false })
      .limit(2),
  ])

  if (bandError) return { ok: false, status: 500, error: `buy_bands query failed: ${bandError.message}` }

  // If current FY's allocation has no category, fall back to any FY for this symbol.
  let alloc = fyAllocMeta
  if (!alloc?.category) {
    const { data: anyAlloc } = await supabase
      .from('stock_allocations')
      .select('category')
      .eq('user_id', userId).eq('symbol', upperSymbol)
      .not('category', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (anyAlloc?.category) alloc = { ...anyAlloc, ...fyAllocMeta }
  }

  // Use stored band values — bands are only recomputed on Regen Bands.
  // effectiveBands applies the risk overlay (risk_multiplier) once, so every
  // downstream step — snowball, conviction, staged-deep cap, tranche pricing —
  // sees the same adjusted bands as the Buy Band display.
  const { buyLow, buyHigh, midLow, midHigh, trimPrice } = effectiveBands(band)

  if (!buyLow || !buyHigh) {
    const why = !band
      ? 'no buy_bands row found — run Regen Bands first'
      : !alloc
        ? `no stock_allocations row found for fy_id=${fyId}`
        : !alloc.category
          ? 'category not set on this allocation row'
          : 'bands not set — run Regen Bands to compute'
    return { ok: false, status: 422, error: `Cannot generate tranches for ${upperSymbol}: ${why}` }
  }

  // Compute remaining budget for this stock in this FY
  const [{ data: fy }, { data: fyAlloc }, { data: txns }] = await Promise.all([
    supabase.from('fiscal_years').select('total_budget_inr, unallocated_carryover_inr').eq('id', fyId).single(),
    supabase.from('stock_allocations')
      .select('allocation_pct')
      .eq('user_id', userId).eq('fy_id', fyId).eq('symbol', upperSymbol)
      .maybeSingle(),
    supabase.from('transactions')
      .select('trade_type, amount')
      .eq('user_id', userId).eq('symbol', upperSymbol)
      .eq('fy_id', fyId),
  ])

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
    .eq('user_id', userId)
    .eq('symbol', upperSymbol)
    .eq('trade_type', 'buy')

  const minBuyPrice = allSymbolBuys && allSymbolBuys.length > 0
    ? Math.min(...allSymbolBuys.map((t: { price: number }) => t.price))
    : null

  // 1-year daily chart: live CMP (from meta) + 52-week low (from daily lows)
  const chart = await fetchYearChart(upperSymbol)
  const liveCmp: number | null = chart.price ?? band?.cmp ?? null
  const fiftyTwoWeekLow = chart.week52Low

  // Staged buy: in deep value zone, cap effective CMP below the user's cheapest prior entry.
  const stagedCmp = stagedDeepCmp(liveCmp, buyLow, minBuyPrice)

  const deployable = remaining
  const isIndex = alloc?.category ? INDEX_CATEGORIES.has(alloc.category as StockCategory) : false

  // Compute Snowball signal from stored snapshots and live CMP
  const snap0 = snapshots?.[0] ?? null
  const snap1 = snapshots?.[1] ?? null
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
    return {
      ok: true,
      blocked: true,
      reason: `No tranches generated — stock is in ${snowball?.zone ?? 'mid/watch'} zone`,
    }
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
    const anchorRaw = (allSymbolBuys as { price: number }[])
      .map(t => t.price)
      .filter(p => p >= priceMin && p <= priceMax)
      .sort((a, b) => b - a)[0]
    if (anchorRaw != null) {
      const anchor = snapPrice(anchorRaw)
      const alreadyCovered = sortedPrices.some(p => Math.abs(p - anchor) <= snapUnit(anchor))
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
    .eq('user_id', userId)
    .eq('symbol', upperSymbol)
    .eq('fy_id', fyId)

  const trancheRows = sortedPrices.map((price, i) => {
    const amt = amounts[i] ?? 0
    return {
      user_id:    userId,
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

  if (error) return { ok: false, status: 500, error: error.message }

  revalidateTag('buy_tranches', {})

  // Reachability warning: flag if >50% of tranches are >15% below CMP
  const farCount = liveCmp
    ? sortedPrices.filter(p => (liveCmp - p) / liveCmp > 0.15).length
    : 0
  const warning = liveCmp && farCount > sortedPrices.length / 2
    ? '⚠️ Majority of capital parked >15% below CMP. Review whether deployment timing is appropriate.'
    : null

  return {
    ok: true,
    blocked: false,
    tranches: (inserted ?? []) as BuyTranche[],
    warning,
    debug: { buyLow, buyHigh, liveCmp, stagedCmp, minBuyPrice, fiftyTwoWeekLow, deployable, conviction, zone: snowball?.zone, signal: snowball?.signal },
  }
}
