import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { calculateBands, computeTrancheprices } from '@/lib/band-calculator'
import type { StockCategory } from '@/lib/types'

// ── AI provider helpers ───────────────────────────────────────────────────────

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

async function callClaude(prompt: string, key: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-beta': 'web-search-2025-03-05',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')
  return textBlock?.text ?? ''
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
- "EPS in Rs" row → EPS per share in ₹. This is rupees per share, NOT crores. Typical range: ₹5–₹300.
- "Net Profit" row → in ₹ Crores (you will use this only for cross-checking).
- "Operating Profit" row → in ₹ Crores. This is EBITDA. Typical large-cap range: ₹500–₹50,000 Cr.

From the Balance Sheet table, most recent available period:
- "Borrowings" row → total debt in ₹ Crores
- "Cash Equivalents" row → cash and bank balances in ₹ Crores

From Key Ratios or the company header:
- Equity shares outstanding in Crores (e.g. 150 Cr shares = 1.5 billion shares; typical range: 5–1000 Cr)
  IMPORTANT: Screener shows shares in Crores. Do not confuse with millions. If you see "20.4" that means 20.4 Cr shares (204 million), report 20.4.

Self-validation before returning (do not include in output):
- Verify: EPS × sharesCr ≈ Net Profit (₹Cr). If they differ by more than 3x, you have a unit error — recheck EPS or shares.
- EPS below ₹2 for a large/mid-cap with significant profits almost always means a scale error.

Return ONLY this JSON, no markdown, no explanation:
{"eps":0,"opProfitCr":0,"borrowingsCr":0,"cashCr":0,"sharesCr":0,"asOf":""}

asOf = the period label of the data used, e.g. "TTM Mar25" or "FY25"`
}

function insurancePrompt(symbol: string): string {
  return `Find the most recent Group Embedded Value (EV) for NSE:${symbol} — an Indian life insurance company.

The Embedded Value is a consolidated Group-level figure published in their annual report or investor presentation. It is labelled "Embedded Value", "Group EV", or "EV" in ₹ Crores.
- For SBILIFE: typically ₹50,000–₹70,000 Cr
- For HDFCLIFE: typically ₹40,000–₹60,000 Cr
- For LICI: typically ₹4,00,000+ Cr
- For mid-size insurers: ₹5,000–₹25,000 Cr

IMPORTANT: This is NOT the market cap. It is NOT the book value. It is the actuarially computed Embedded Value — a specific insurance metric.

Also find:
- Equity shares outstanding in Crores (e.g. 100 Cr shares = 1 billion shares; typical range for listed insurers: 20–700 Cr)

Self-validation: EV ÷ shares should give EV per share in the range of ₹300–₹2,000 for most listed life insurers. If your result is below ₹100 or above ₹5,000, recheck the EV figure or share count.

Sources: NSE disclosures (nseindia.com), investor presentations, annual reports, screener.in, moneycontrol.com.

Return ONLY this JSON, no markdown, no explanation:
{"embeddedValue":0,"sharesCr":0,"asOf":""}

asOf = the period the embedded value relates to (e.g. "FY25", "Mar 2025")`
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
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()
  const body = await req.json().catch(() => ({})) as { fyId?: string }
  const fyId = body.fyId ?? null

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Determine AI provider and active key
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('gemini_api_key, claude_api_key, ai_provider')
    .eq('user_id', user.id)
    .maybeSingle()

  const aiProvider = userSettings?.ai_provider ?? 'gemini'
  const activeKey = aiProvider === 'claude'
    ? userSettings?.claude_api_key
    : (userSettings?.gemini_api_key || process.env.GEMINI_API_KEY)

  if (!activeKey) return NextResponse.json({
    error: aiProvider === 'claude'
      ? 'No Claude API key configured. Add your key in Settings (profile icon).'
      : 'No Gemini API key configured. Add your key in Settings (profile icon).',
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
  const isIndex     = category === 'Index/ETF'
  const isInsurance = category === 'Insurance'

  // Call AI provider with search grounding
  let aiText: string
  const prompt = isIndex ? indexPrompt(upperSymbol)
    : isInsurance ? insurancePrompt(upperSymbol)
    : stockPrompt(upperSymbol)
  try {
    aiText = aiProvider === 'claude'
      ? await callClaude(prompt, activeKey)
      : await callGemini(prompt, activeKey)
  } catch (e: unknown) {
    return NextResponse.json({
      error: `${aiProvider === 'claude' ? 'Claude' : 'Gemini'} fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    }, { status: 502 })
  }

  // Parse JSON from AI text response
  let parsed: Record<string, unknown>
  try {
    parsed = extractJSON(aiText)
  } catch {
    return NextResponse.json({
      error: `Could not parse JSON from ${aiProvider === 'claude' ? 'Claude' : 'Gemini'} response`,
      raw: aiText.slice(0, 600),
    }, { status: 502 })
  }

  // Map parsed data to band inputs
  let eps: number | null           = null
  let opProfitCr: number | null    = null
  let borrowingsCr: number | null  = null
  let cashCr: number | null        = null
  let sharesCr: number | null      = null
  let embeddedValue: number | null = null
  let asOf = String(parsed.asOf ?? '')

  if (isIndex) {
    const niftyPE    = Number(parsed.niftyPE)    || null
    const etfPrice   = Number(parsed.etfPrice)   || null
    const niftyLevel = Number(parsed.niftyLevel) || null

    if (!niftyPE || !etfPrice) {
      return NextResponse.json({
        error: 'Gemini could not extract Nifty PE or ETF price',
        raw: aiText.slice(0, 600),
      }, { status: 422 })
    }

    eps  = etfPrice / niftyPE
    asOf = `Nifty ${niftyLevel?.toFixed(0)} @ ${niftyPE}x PE | ETF ₹${etfPrice} | ${asOf}`
  } else if (isInsurance) {
    embeddedValue = Number(parsed.embeddedValue) || null
    sharesCr      = Number(parsed.sharesCr)      || null

    if (!embeddedValue || !sharesCr) {
      return NextResponse.json({
        error: `Could not extract Embedded Value or shares for ${upperSymbol}. Got: EV=${embeddedValue}Cr, Shares=${sharesCr}Cr`,
        raw: aiText.slice(0, 600),
      }, { status: 422 })
    }
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
  const result = calculateBands({
    category,
    twoWeakQuarters:     alloc.two_weak_quarters     ?? false,
    twoStrongQuarters:   alloc.two_strong_quarters    ?? false,
    isHospitalRampPhase: alloc.is_hospital_ramp_phase ?? false,
    eps,
    bvps:          null,
    ebitda:        opProfitCr,
    netDebt:       netDebtCr,
    shares:        sharesCr,
    embeddedValue,
  })

  if (!result) {
    return NextResponse.json({
      error: `Not enough data to compute bands for ${upperSymbol}. Got: EPS=${eps}, OpProfit=${opProfitCr}Cr, Shares=${sharesCr}Cr`,
      raw: aiText.slice(0, 600),
    }, { status: 422 })
  }

  const anchorRaw   = result.anchorUsed.toUpperCase()
  const anchor_type = anchorRaw.includes('EV/EBITDA') ? 'EV_EBITDA'
    : anchorRaw.includes('P/EV') ? 'P_EV'
    : anchorRaw.includes('PB')   ? 'PB'
    : 'PE'

  // Preserve existing CMP before overwriting
  const { data: existingBand } = await supabase
    .from('buy_bands')
    .select('manual_cmp')
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .eq('is_current', true)
    .maybeSingle()
  const existingCmp = existingBand?.manual_cmp ?? null

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
      ebitda:         opProfitCr,
      net_debt:       netDebtCr,
      shares:         sharesCr,
      embedded_value: embeddedValue,
      buy_low:    result.buyLow,
      buy_high:   result.buyHigh,
      mid_low:    result.midLow,
      mid_high:   result.midHigh,
      trim_price: result.trimPrice,
      manual_cmp: existingCmp,
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

  // ── Auto-generate tranches ─────────────────────────────────────────────────
  let generatedTranches: unknown[] = []

  if (fyId) {
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

    const prices = computeTrancheprices(result.buyLow, result.buyHigh, existingCmp)
    const amtPerTranche = prices.length > 0 ? remaining / prices.length : 0

    // Delete existing tranches for this symbol + FY, then insert fresh ones
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

    const { data: inserted } = await supabase
      .from('buy_tranches')
      .insert(trancheRows)
      .select()

    generatedTranches = inserted ?? []
  }

  return NextResponse.json({
    symbol: upperSymbol,
    category,
    financials: { eps, opProfitCr, borrowingsCr, cashCr, sharesCr, netDebtCr },
    asOf,
    band:     newBand,
    result,
    tranches: generatedTranches,
  })
}
