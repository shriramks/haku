'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserId, getMFFunds, getMFTransactions, getSGBTransactions, getPPFTransactions, getEPFTransactions, getUsHoldings, getUsTransactions, getFxRates } from '@/lib/data'
import { rateOnOrBefore } from '@/lib/fx'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, EPFTransaction, UsHolding, UsTransaction } from '@/lib/portfolio-types'

/**
 * Fetches all portfolio-table data (MF/Gold/PPF/EPF) via the unstable_cache-wrapped
 * getters in lib/data.ts — used by TransactionsClient's lazy portfolio load so repeat
 * visits hit the warm Data Cache instead of a fresh Supabase round trip per table.
 */
export async function loadPortfolioTables(): Promise<{
  mfFunds: MFund[]
  mfTransactions: MFTransaction[]
  sgbTransactions: SGBTransaction[]
  ppfTransactions: PPFTransaction[]
  epfTransactions: EPFTransaction[]
  usHoldings: UsHolding[]
  usTransactions: UsTransaction[]
}> {
  const [mfFunds, mfTransactions, sgbTransactions, ppfTransactions, epfTransactions, usHoldings, usTransactions] = await Promise.all([
    getMFFunds(),
    getMFTransactions(),
    getSGBTransactions(),
    getPPFTransactions(),
    getEPFTransactions(),
    getUsHoldings(),
    getUsTransactions(),
  ])
  return { mfFunds, mfTransactions, sgbTransactions, ppfTransactions, epfTransactions, usHoldings, usTransactions }
}

// ── MF ────────────────────────────────────────────────────────────────────────

export async function upsertMFund(schemeCode: string, schemeName: string, schemeType: string) {
  const userId = await getUserId()
  if (!userId) return { error: 'Not authenticated' }

  const sb = await createSupabaseServerClient()
  const { data, error } = await sb
    .from('mf_funds')
    .upsert({ user_id: userId, scheme_code: schemeCode, scheme_name: schemeName, scheme_type: schemeType },
             { onConflict: 'user_id,scheme_code' })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidateTag('mf_funds', {})
  return { fundId: data.id }
}

export async function addMFTransaction(
  fundId: string,
  tradeDate: string,
  tradeType: 'buy' | 'sell',
  units: number,
  nav: number,
) {
  const userId = await getUserId()
  if (!userId) return { error: 'Not authenticated' }

  const sb = await createSupabaseServerClient()
  const { error } = await sb.from('mf_transactions').insert({
    user_id: userId, fund_id: fundId, trade_date: tradeDate,
    trade_type: tradeType, units, nav,
  })

  if (error) return { error: error.message }
  revalidateTag('mf_transactions', {})
  revalidatePath('/portfolio')
  return { ok: true }
}

/** Called right after a client-side edit/delete of an mf_transactions row (TransactionsClient.tsx) — that write bypasses this file's server actions, so the mf_transactions cache tag needs an explicit bust. */
export async function revalidateMFTransactions() {
  revalidateTag('mf_transactions', {})
}

// ── Gold (SGB / ETF / Physical) ───────────────────────────────────────────────

export async function addGoldTransaction(
  goldType: 'sgb' | 'etf' | 'physical',
  name: string | null,
  tradeDate: string,
  tradeType: 'buy' | 'sell',
  grams: number,
  pricePerGram: number,
) {
  const userId = await getUserId()
  if (!userId) return { error: 'Not authenticated' }

  let maturityDate: string | null = null
  if (goldType === 'sgb' && tradeType === 'buy') {
    const d = new Date(tradeDate)
    d.setFullYear(d.getFullYear() + 8)
    maturityDate = d.toISOString().split('T')[0]
  }

  const sb = await createSupabaseServerClient()
  const { error } = await sb.from('sgb_transactions').insert({
    user_id: userId, trade_date: tradeDate, trade_type: tradeType,
    grams, price_per_gram: pricePerGram, maturity_date: maturityDate,
    gold_type: goldType, name,
  })

  if (error) return { error: error.message }
  revalidateTag('sgb_transactions', {})
  revalidatePath('/portfolio')
  return { ok: true }
}

/** Called right after a client-side edit/delete of an sgb_transactions row (TransactionsClient.tsx). */
export async function revalidateSGBTransactions() {
  revalidateTag('sgb_transactions', {})
}

// ── PPF ───────────────────────────────────────────────────────────────────────

export async function addPPFTransaction(
  tradeDate: string,
  tradeType: PPFTransaction['trade_type'],
  amount: number,
) {
  const userId = await getUserId()
  if (!userId) return { error: 'Not authenticated' }

  const sb = await createSupabaseServerClient()
  const { error } = await sb.from('ppf_transactions').insert({
    user_id: userId, trade_date: tradeDate, trade_type: tradeType, amount,
  })

  if (error) return { error: error.message }
  revalidateTag('ppf_transactions', {})
  revalidatePath('/portfolio')
  return { ok: true }
}

/**
 * Called right after a client-side edit/delete of a ppf_transactions row (TransactionsClient.tsx and
 * the Portfolio PPF list). The path revalidation re-renders /portfolio, whose header numbers, totals
 * and XIRR are computed server-side (#125) — the client only patches the list rows itself.
 */
export async function revalidatePPFTransactions() {
  revalidateTag('ppf_transactions', {})
  revalidatePath('/portfolio')
}

// ── EPF ───────────────────────────────────────────────────────────────────────

/** `tradeDate` is the date added (credited); `wageMonth` is the first of the wage month (YYYY-MM-01), null for interest. */
export async function addEPFTransaction(
  tradeDate: string,
  tradeType: 'deposit' | 'interest',
  amount: number,
  wageMonth: string | null,
) {
  const userId = await getUserId()
  if (!userId) return { error: 'Not authenticated' }

  const sb = await createSupabaseServerClient()
  const { error } = await sb.from('epf_transactions').insert({
    user_id: userId, trade_date: tradeDate, wage_month: wageMonth, trade_type: tradeType, amount,
  })

  if (error) return { error: error.message }
  revalidateTag('epf_transactions', {})
  revalidatePath('/portfolio')
  return { ok: true }
}

/** Same as revalidatePPFTransactions, for epf_transactions. */
export async function revalidateEPFTransactions() {
  revalidateTag('epf_transactions', {})
  revalidatePath('/portfolio')
}

export async function setPPFBalanceOverride(balance: number, asOfDate: string) {
  const userId = await getUserId()
  if (!userId) return { error: 'Not authenticated' }

  const sb = await createSupabaseServerClient()
  const { error } = await sb
    .from('ppf_balance_override')
    .upsert({ user_id: userId, balance, as_of_date: asOfDate, updated_at: new Date().toISOString() },
             { onConflict: 'user_id' })

  if (error) return { error: error.message }
  revalidateTag('ppf_balance_override', {})
  revalidatePath('/portfolio')
  return { ok: true }
}

// ── US holdings ───────────────────────────────────────────────────────────────

/** Called after any write to us_holdings. */
export async function revalidateUsHoldings() {
  revalidateTag('us_holdings', {})
}

/** Called after any write to us_transactions. */
export async function revalidateUsTransactions() {
  revalidateTag('us_transactions', {})
}

/** USD->INR close on `date` (previous trading day's if none) — auto-fill for the Add / edit forms. Null when no history covers it. */
export async function getUsdInrOnDate(date: string): Promise<number | null> {
  return rateOnOrBefore(await getFxRates(), date)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export interface UsTradeInput {
  /** Existing holding, or omitted when `newHolding` creates it. */
  holdingId?: string
  newHolding?: { symbol: string; yahooSymbol: string; name: string; region: 'us' | 'india' }
  tradeDate: string
  tradeType: 'buy' | 'sell'
  quantity: number
  price: number     // USD per unit
  fxRate: number    // INR per USD on tradeDate
}

export async function addUsTransaction(input: UsTradeInput): Promise<{ error?: string }> {
  const userId = await getUserId()
  if (!userId) return { error: 'Not signed in' }
  if (!(input.quantity > 0) || !(input.price > 0) || !(input.fxRate > 0)) return { error: 'Enter quantity, price and rate' }
  if (!ISO_DATE.test(input.tradeDate)) return { error: 'Invalid date' }

  const sb = await createSupabaseServerClient()
  let holdingId = input.holdingId
  if (!holdingId) {
    const h = input.newHolding
    const symbol = h?.symbol.trim().toUpperCase()
    const yahoo = h?.yahooSymbol.trim().toUpperCase()
    if (!h || !symbol || !yahoo) return { error: 'Enter the symbol and Yahoo symbol' }
    const { data, error } = await sb
      .from('us_holdings')
      .upsert({ user_id: userId, symbol, yahoo_symbol: yahoo, name: h.name.trim(), region: h.region },
              { onConflict: 'user_id,symbol' })
      .select('id')
      .single()
    if (error) return { error: error.message }
    holdingId = data.id
    revalidateTag('us_holdings', {})
  }

  const { error } = await sb.from('us_transactions').insert({
    user_id: userId, holding_id: holdingId, trade_date: input.tradeDate, trade_type: input.tradeType,
    quantity: input.quantity, price: input.price, fx_rate: input.fxRate,
  })
  if (error) return { error: error.message }
  revalidateTag('us_transactions', {})
  revalidatePath('/portfolio')
  return {}
}

export async function updateUsTransaction(
  id: string,
  patch: { quantity: number; price: number; fx_rate: number; trade_date: string },
): Promise<{ error?: string }> {
  const userId = await getUserId()
  if (!userId) return { error: 'Not signed in' }
  const { quantity, price, fx_rate, trade_date } = patch
  if (!(quantity > 0) || !(price > 0) || !(fx_rate > 0)) return { error: 'Enter quantity, price and rate' }
  if (!ISO_DATE.test(trade_date)) return { error: 'Invalid date' }
  const sb = await createSupabaseServerClient()
  const { error } = await sb.from('us_transactions').update({ quantity, price, fx_rate, trade_date }).eq('id', id).eq('user_id', userId)
  if (error) return { error: error.message }
  revalidateTag('us_transactions', {})
  revalidatePath('/portfolio')
  return {}
}

export async function deleteUsTransaction(id: string): Promise<{ error?: string }> {
  const userId = await getUserId()
  if (!userId) return { error: 'Not signed in' }
  const sb = await createSupabaseServerClient()
  const { error } = await sb.from('us_transactions').delete().eq('id', id).eq('user_id', userId)
  if (error) return { error: error.message }
  revalidateTag('us_transactions', {})
  revalidatePath('/portfolio')
  return {}
}
