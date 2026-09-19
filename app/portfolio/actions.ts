'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserId, getMFFunds, getMFTransactions, getSGBTransactions, getPPFTransactions, getEPFTransactions } from '@/lib/data'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, EPFTransaction } from '@/lib/portfolio-types'

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
}> {
  const [mfFunds, mfTransactions, sgbTransactions, ppfTransactions, epfTransactions] = await Promise.all([
    getMFFunds(),
    getMFTransactions(),
    getSGBTransactions(),
    getPPFTransactions(),
    getEPFTransactions(),
  ])
  return { mfFunds, mfTransactions, sgbTransactions, ppfTransactions, epfTransactions }
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

/** Called right after a client-side edit/delete of a ppf_transactions row (TransactionsClient.tsx). */
export async function revalidatePPFTransactions() {
  revalidateTag('ppf_transactions', {})
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

/** Called right after a client-side edit/delete of an epf_transactions row (TransactionsClient.tsx). */
export async function revalidateEPFTransactions() {
  revalidateTag('epf_transactions', {})
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
