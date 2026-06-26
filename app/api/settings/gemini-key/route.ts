import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { encrypt } from '@/lib/encrypt'

const INDEX_CATEGORIES = new Set(['Nifty 50 Index', 'Nifty Next 50 Index'])

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('user_settings')
    .select('gemini_api_key, risk_free')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    hasKey: !!data?.gemini_api_key,
    riskFree: data?.risk_free ?? 0.07,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    key,
    riskFree,
  } = await req.json()

  if (riskFree !== undefined && riskFree !== null) {
    const { data: currentSettings } = await supabase
      .from('user_settings')
      .select('risk_free')
      .eq('user_id', user.id)
      .maybeSingle()

    const parsedRiskFree = Number(riskFree)
    if (!Number.isFinite(parsedRiskFree) || parsedRiskFree <= 0 || parsedRiskFree >= 1) {
      return NextResponse.json({ error: 'risk_free must be a decimal between 0 and 1' }, { status: 400 })
    }

    const currentRiskFree = Number(currentSettings?.risk_free ?? 0.07)
    const riskFreeChanged = Math.abs(currentRiskFree - parsedRiskFree) > 0.000001
    const now = new Date().toISOString()

    const { error } = await supabase.from('user_settings').upsert(
      {
        user_id: user.id,
        risk_free: parsedRiskFree,
        risk_free_updated_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (riskFreeChanged) {
      const { data: allocations } = await supabase
        .from('stock_allocations')
        .select('symbol, category')
        .eq('user_id', user.id)

      const nonIndexSymbols = Array.from(new Set(
        (allocations ?? [])
          .filter((row: { category: string }) => !INDEX_CATEGORIES.has(row.category))
          .map((row: { symbol: string }) => row.symbol)
      ))

      if (nonIndexSymbols.length > 0) {
        const { error: staleError } = await supabase
          .from('buy_bands')
          .update({ last_updated_at: now })
          .eq('user_id', user.id)
          .in('symbol', nonIndexSymbols)

        if (staleError) return NextResponse.json({ error: staleError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, riskFree: parsedRiskFree })
  }

  if (key === null || key === '') {
    await supabase.from('user_settings').upsert(
      { user_id: user.id, gemini_api_key: null, ai_provider: 'gemini', updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    return NextResponse.json({ success: true, hasKey: false })
  }

  if (!key.startsWith('AIza')) {
    return NextResponse.json({ error: 'Invalid Gemini API key — should start with AIza' }, { status: 400 })
  }

  let encryptedKey: string
  try {
    encryptedKey = await encrypt(key)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Encryption failed' }, { status: 500 })
  }

  const { error } = await supabase.from('user_settings').upsert(
    { user_id: user.id, gemini_api_key: encryptedKey, ai_provider: 'gemini', updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, hasKey: true })
}
