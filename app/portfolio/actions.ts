'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

async function getUserId(): Promise<string | null> {
  const sb = await createSupabaseServerClient()
  const { data: { session } } = await sb.auth.getSession()
  return session?.user.id ?? null
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

  return error ? { error: error.message } : { fundId: data.id }
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
  revalidatePath('/portfolio')
  return { ok: true }
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
  revalidatePath('/portfolio')
  return { ok: true }
}

// ── PPF ───────────────────────────────────────────────────────────────────────

export async function addPPFTransaction(
  tradeDate: string,
  tradeType: 'deposit' | 'withdrawal',
  amount: number,
  notes = '',
) {
  const userId = await getUserId()
  if (!userId) return { error: 'Not authenticated' }

  const sb = await createSupabaseServerClient()
  const { error } = await sb.from('ppf_transactions').insert({
    user_id: userId, trade_date: tradeDate, trade_type: tradeType, amount, notes,
  })

  if (error) return { error: error.message }
  revalidatePath('/portfolio')
  return { ok: true }
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
  revalidatePath('/portfolio')
  return { ok: true }
}
