import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { calculateBands } from '@/lib/band-calculator'
import type { StockCategory } from '@/lib/types'

// ── Gemini helpers ────────────────────────────────────────────────────────────

async function callGemini(prompt: string, key: string): Promise<string> {

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tools: [{ google_search: {} }],
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    }
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

function extractJSON(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON block found in response')
  return JSON.parse(text.slice(start, end + 1))
}

function stockPrompt(symbol: string): string {
  return `Open https://www.screener.in/company/${symbol}/consolidated/ — the consolidated financials page for NSE:${symbol}.

From the Profit & Loss table, read the RIGHTMOST non-empty column (most recent period — prefer TTM if shown, else latest annual FY):
- "EPS in Rs" row → EPS per share in ₹. This is rupees per share, NOT crores. Typical range: ₹5–₹200.
- "Operating Profit" row → in ₹ Crores. This is EBITDA. Typical large-cap range: ₹500–₹50,000 Cr.

From the Balance Sheet table, most recent available period:
- "Borrowings" row → total debt in ₹ Crores
- "Cash Equivalents" row → cash and bank balances in ₹ Crores

From Key Ratios or the company header:
- Equity shares outstanding in Crores (e.g. 150 Cr shares = 1.5 billion shares; typical range: 10–1000 Cr)

Sanity check before returning: EPS × shares (Cr) × 100 should roughly equal the net profit (PAT) shown in the P&L. If the implied market cap seems absurd (under ₹100 Cr or over ₹50 lakh Cr for a listed company), recheck the source page.

Return ONLY this JSON, no markdown, no explanation:
{"eps":0,"opProfitCr":0,"borrowingsCr":0,"cashCr":0,"sharesCr":0,"asOf":""}

asOf = the period label of the data used, e.g. "TTM Mar25" or "FY25"`
}

function indexPrompt(symbol: string): string {
  return `Find current Nifty 50 valuation data from NSE India (nseindia.com) or Moneycontrol:
1. Current Nifty 50 trailing PE ratio (price-to-earnings based on last 12 months earnings, NOT forward PE)
2. Current Nifty 50 index level
3. Current market price per unit of ETF NSE:${symbol} in ₹ — use the latest traded price, NOT the NAV

Sanity check: Nifty trailing PE is normally between 15 and 35. ETF price for most Nifty 50 ETFs is roughly Nifty level ÷ 100. If your numbers fall far outside these ranges, recheck.

Return ONLY this JSON, no markdown, no explanation:
{"niftyPE":0,"niftyLevel":0,"etfPrice":0,"asOf":""}

asOf = today's date or the date of the data`
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use user's personal key if set, else fall back to server env key
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('gemini_api_key')
    .eq('user_id', user.id)
    .maybeSingle()

  const geminiKey = userSettings?.gemini_api_key || process.env.GEMINI_API_KEY
  if (!geminiKey) return NextResponse.json({
    error: 'No Gemini API key configured. Add your key in Settings (profile icon).',
  }, { status: 500 })

  // Fetch allocation for category + qualifier flags
  const { data: alloc } = await supabase
    .from('stock_allocations')
    .select('category, two_weak_quarters, two_strong_quarters, is_hospital_ramp_phase')
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .limit(1)
    .single()

  if (!alloc?.category) {
    return NextResponse.json({
      error: `${upperSymbol} not found in your allocations. Add it to a plan first.`,
    }, { status: 422 })
  }

  const category = alloc.category as StockCategory
  const isIndex  = category === 'Index/ETF'

  // Call Gemini with search grounding
  let geminiText: string
  try {
    geminiText = await callGemini(isIndex ? indexPrompt(upperSymbol) : stockPrompt(upperSymbol), geminiKey)
  } catch (e: unknown) {
    return NextResponse.json({
      error: `Gemini fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    }, { status: 502 })
  }

  // Parse JSON from Gemini text response
  let parsed: Record<string, unknown>
  try {
    parsed = extractJSON(geminiText)
  } catch {
    return NextResponse.json({
      error: 'Could not parse JSON from Gemini response',
      raw: geminiText.slice(0, 600),
    }, { status: 502 })
  }

  // Map parsed data to band inputs
  let eps: number | null        = null
  let opProfitCr: number | null = null
  let borrowingsCr: number | null = null
  let cashCr: number | null     = null
  let sharesCr: number | null   = null
  let asOf = String(parsed.asOf ?? '')

  if (isIndex) {
    const niftyPE   = Number(parsed.niftyPE)   || null
    const etfPrice  = Number(parsed.etfPrice)   || null
    const niftyLevel = Number(parsed.niftyLevel) || null

    if (!niftyPE || !etfPrice) {
      return NextResponse.json({
        error: 'Gemini could not extract Nifty PE or ETF price',
        raw: geminiText.slice(0, 600),
      }, { status: 422 })
    }

    // ETF EPS equivalent = etfPrice / niftyPE
    // Applying PE band multiples (16x–25x) to this gives band prices in ₹ ETF terms
    eps  = etfPrice / niftyPE
    asOf = `Nifty ${niftyLevel?.toFixed(0)} @ ${niftyPE}x PE | ETF ₹${etfPrice} | ${asOf}`
  } else {
    eps          = Number(parsed.eps)          || null
    opProfitCr   = Number(parsed.opProfitCr)   || null
    borrowingsCr = Number(parsed.borrowingsCr) || null
    cashCr       = Number(parsed.cashCr)       || null
    sharesCr     = Number(parsed.sharesCr)     || null
  }

  const netDebtCr = (borrowingsCr !== null && cashCr !== null)
    ? borrowingsCr - cashCr
    : null

  // Calculate bands
  let result = calculateBands({
    category,
    twoWeakQuarters:     alloc.two_weak_quarters     ?? false,
    twoStrongQuarters:   alloc.two_strong_quarters    ?? false,
    isHospitalRampPhase: alloc.is_hospital_ramp_phase ?? false,
    eps,
    bvps:         null,
    ebitda:       opProfitCr,
    netDebt:      netDebtCr,
    shares:       sharesCr,
    embeddedValue: null,
  })

  // Insurance fallback: P/EV needs embedded value (not available) — fall back to PE
  if (!result && category === 'Insurance' && eps && eps > 0) {
    result = calculateBands({
      category:            'FMCG' as StockCategory,
      twoWeakQuarters:     alloc.two_weak_quarters  ?? false,
      twoStrongQuarters:   alloc.two_strong_quarters ?? false,
      isHospitalRampPhase: false,
      eps, bvps: null, ebitda: null, netDebt: null, shares: null, embeddedValue: null,
    })
    if (result) result = { ...result, anchorUsed: result.anchorUsed + ' [Insurance PE fallback]' }
  }

  if (!result) {
    return NextResponse.json({
      error: `Not enough data to compute bands for ${upperSymbol}. Got: EPS=${eps}, OpProfit=${opProfitCr}Cr, Shares=${sharesCr}Cr`,
      raw: geminiText.slice(0, 600),
    }, { status: 422 })
  }

  const anchorRaw   = result.anchorUsed.toUpperCase()
  const anchor_type = anchorRaw.includes('EV/EBITDA') ? 'EV_EBITDA'
    : anchorRaw.includes('P/EV') ? 'P_EV'
    : anchorRaw.includes('PB')   ? 'PB'
    : 'PE'

  // Version the band — mark old as not current
  await supabase
    .from('buy_bands')
    .update({ is_current: false })
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .eq('is_current', true)

  const now = new Date().toISOString()
  const { data: newBand, error: insertError } = await supabase
    .from('buy_bands')
    .insert({
      user_id:    user.id,
      symbol:     upperSymbol,
      anchor_type,
      eps,
      bvps:       null,
      ebitda:     opProfitCr,
      net_debt:   netDebtCr,
      shares:     sharesCr,
      embedded_value: null,
      buy_low:    result.buyLow,
      buy_high:   result.buyHigh,
      mid_low:    result.midLow,
      mid_high:   result.midHigh,
      trim_price: result.trimPrice,
      manual_cmp: null,
      notes:      `${result.anchorUsed} | ${asOf}`,
      last_updated_at: now,
      generated_at:    now,
      is_current:      true,
    })
    .select()
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({
    symbol: upperSymbol,
    category,
    financials: { eps, opProfitCr, borrowingsCr, cashCr, sharesCr, netDebtCr },
    asOf,
    band:   newBand,
    result,
  })
}
