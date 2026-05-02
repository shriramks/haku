import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { calculateBands, computeGrowth, computeTranchePrices, deriveIndexEps, getCostOfEquity } from '@/lib/band-calculator'
import { fetchCmp } from '@/lib/market-data'
import { decrypt } from '@/lib/encrypt'
import type { StockCategory } from '@/lib/types'

// ── AI provider helpers ───────────────────────────────────────────────────────

// Model preference order — tried in sequence until one succeeds
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]

async function callGemini(prompt: string, key: string): Promise<string> {
  let lastErr: Error = new Error('No Gemini models available')

  for (const model of GEMINI_MODELS) {
    let res: Response
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            tools: [{ google_search: {} }],
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
          }),
          signal: AbortSignal.timeout(45_000),
        }
      )
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      continue  // network/timeout — try next model
    }

    if (res.status === 503 || res.status === 429 || res.status === 404) {
      lastErr = new Error(`Gemini ${res.status}: ${await res.text()}`)
      continue  // capacity/rate-limit/unavailable — try next model
    }

    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)

    const data = await res.json()
    const parts: Array<{ text?: string; thought?: boolean }> = data.candidates?.[0]?.content?.parts ?? []
    // Skip thought parts from reasoning models; fall back to first part if all filtered
    const textParts = parts.filter(p => p.text && !p.thought)
    return (textParts.map(p => p.text).join('') || parts[0]?.text) ?? ''
  }

  throw new Error(`Gemini fetch failed: ${lastErr.message}`)
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
  return `Open https://www.screener.in/company/${symbol}/consolidated/ — consolidated financials for NSE:${symbol}.

From the Profit & Loss table, read the RIGHTMOST non-empty column (most recent — prefer TTM if shown, else latest annual FY):
- "EPS in Rs" row → EPS per share in ₹ (rupees per share, NOT crores). Typical range: ₹5–₹300 for large/mid-caps.
- "Net Profit" row → PAT now in Cr (current period, same rightmost column)
- "Net Profit" from 3 years prior (the column 3 years before the rightmost) → PAT 3yr ago in Cr
From the Ratios section:
- 3-year average ROCE % (or ROE % for financial/insurance companies)
From the page header:
- Market Capitalisation in Cr

Self-validation (do not include in output):
- EPS below ₹2 for a large/mid-cap almost always means a scale error — recheck.
- PAT should be in Crores (e.g. 1,000–50,000 for mid/large-caps), not rupees.

Return ONLY this JSON, no markdown, no explanation:
{"eps":0,"patNow":0,"pat3yrAgo":0,"roce3yrAvg":0,"mcap":0,"asOf":""}

asOf = the period label used, e.g. "TTM Mar25" or "FY25"`
}

function indexPrompt(symbol: string): string {
  return `Look up NSE:${symbol} and identify which index it tracks. Then find:
1. Current index level (e.g. Nifty 50 at 22,500)
2. Current trailing PE ratio of that index (last 12 months, NOT forward PE). If commodity ETF (gold, silver, etc.), set indexPE to 0.

Sanity check: Trailing PE for Indian equity indices is normally 15–40.

Return ONLY this JSON, no markdown, no explanation:
{"indexLevel":0,"indexPE":0,"asOf":""}

asOf = brief description, e.g. "Nifty Next 50 @ 28.4x PE, level 70,500 | Mar 2025"`
}

type GenerateAction = 'bands' | 'financials'

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()
  const body = await req.json().catch(() => ({})) as { fyId?: string; action?: GenerateAction }
  const fyId = body.fyId ?? null
  const action: GenerateAction = body.action === 'financials' ? 'financials' : 'bands'

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: userSettings }, { data: alloc }, { data: existingBand }] = await Promise.all([
    supabase
      .from('user_settings')
      .select('gemini_api_key, claude_api_key, ai_provider, risk_free')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('stock_allocations')
      .select('category')
      .eq('user_id', user.id)
      .eq('symbol', upperSymbol)
      .limit(1)
      .single(),
    supabase
      .from('buy_bands')
      .select('id, eps, pat_now, pat_3yr_ago, roce_3yr_avg, mcap, index_level, index_pe, manual_cmp, notes, generated_at, risk_multiplier')
      .eq('user_id', user.id)
      .eq('symbol', upperSymbol)
      .maybeSingle(),
  ])

  if (!alloc?.category) {
    return NextResponse.json({
      error: `${upperSymbol} not found in your allocations. Add it to a plan first.`,
    }, { status: 422 })
  }

  const category = alloc.category as StockCategory
  const isIndex = category === 'Nifty 50 Index' || category === 'Nifty Next 50 Index'
  const riskFree = userSettings?.risk_free ?? 0.07
  const ke = getCostOfEquity(riskFree)
  const existingCmp = existingBand?.manual_cmp ?? null

  if (action === 'financials') {
    const aiProvider = userSettings?.ai_provider ?? 'gemini'
    const rawKey = aiProvider === 'claude'
      ? userSettings?.claude_api_key
      : userSettings?.gemini_api_key
    const activeKey = rawKey ? await decrypt(rawKey) : null

    if (!activeKey) {
      return NextResponse.json({
        error: aiProvider === 'claude'
          ? 'No Claude API key configured. Add your key in Settings (profile icon).'
          : 'No Gemini API key configured. Add your key in Settings (profile icon).',
      }, { status: 500 })
    }

    let aiText: string
    const prompt = isIndex ? indexPrompt(upperSymbol) : stockPrompt(upperSymbol)
    const callAI = () => aiProvider === 'claude'
      ? callClaude(prompt, activeKey)
      : callGemini(prompt, activeKey)
    const providerName = aiProvider === 'claude' ? 'Claude' : 'Gemini'

    try {
      aiText = await callAI()
    } catch {
      try {
        aiText = await callAI()
      } catch (e2: unknown) {
        return NextResponse.json({
          error: `${providerName} fetch failed: ${e2 instanceof Error ? e2.message : String(e2)}`,
        }, { status: 502 })
      }
    }

    let parsed: Record<string, unknown>
    try {
      parsed = extractJSON(aiText)
    } catch {
      return NextResponse.json({
        error: `Could not parse JSON from ${aiProvider === 'claude' ? 'Claude' : 'Gemini'} response`,
        raw: aiText.slice(0, 600),
      }, { status: 502 })
    }

    let eps: number | null = null
    let asOf = String(parsed.asOf ?? '')
    let indexLevel: number | null = null
    let indexPE: number | null = null
    let patNow: number | null = null
    let pat3yrAgo: number | null = null
    let roce3yrAvg: number | null = null
    let mcap: number | null = null

    if (isIndex) {
      indexLevel = Number(parsed.indexLevel) || null
      indexPE    = Number(parsed.indexPE) || null

      if (!indexLevel) {
        return NextResponse.json({ error: 'Could not extract index level', raw: aiText.slice(0, 600) }, { status: 422 })
      }
      if (!indexPE) {
        return NextResponse.json({
          error: `${upperSymbol} appears to be a non-equity ETF (commodity/debt) — PE-based bands don't apply. Set price targets manually.`,
          raw: aiText.slice(0, 600),
        }, { status: 422 })
      }
      eps = deriveIndexEps(indexLevel, indexPE)
    } else {
      eps        = Number(parsed.eps) || null
      patNow     = Number(parsed.patNow) || null
      pat3yrAgo  = Number(parsed.pat3yrAgo) || null
      roce3yrAvg = Number(parsed.roce3yrAvg) || null
      mcap       = Number(parsed.mcap) || null

      if (!eps) {
        try {
          const retryText = await callAI()
          const retryParsed = extractJSON(retryText)
          eps        = Number(retryParsed.eps) || eps
          patNow     = Number(retryParsed.patNow) || patNow
          pat3yrAgo  = Number(retryParsed.pat3yrAgo) || pat3yrAgo
          roce3yrAvg = Number(retryParsed.roce3yrAvg) || roce3yrAvg
          mcap       = Number(retryParsed.mcap) || mcap
          if (retryParsed.asOf) asOf = String(retryParsed.asOf)
          aiText = retryText
        } catch {
          // ignore retry failure
        }
      }
    }

    if (!eps) {
      return NextResponse.json({
        error: `Not enough data to save financials for ${upperSymbol}. Got: EPS=${eps}`,
        raw: aiText.slice(0, 600),
      }, { status: 422 })
    }

    const now = new Date().toISOString()
    const payload: Record<string, unknown> = {
      user_id: user.id,
      symbol: upperSymbol,
      anchor_type: 'PE',
      eps,
      manual_cmp: existingCmp,
      notes: asOf,
      last_updated_at: now,
      generated_at: existingBand?.generated_at ?? now,
    }

    if (isIndex) {
      payload.index_level = indexLevel
      payload.index_pe = indexPE
    } else {
      payload.pat_now = patNow
      payload.pat_3yr_ago = pat3yrAgo
      payload.roce_3yr_avg = roce3yrAvg
      payload.mcap = mcap
    }

    const { data: savedBand, error } = await supabase
      .from('buy_bands')
      .upsert(payload, { onConflict: 'user_id,symbol' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    revalidateTag('buy_bands', {})

    return NextResponse.json({
      symbol: upperSymbol,
      category,
      mode: action,
      financials: isIndex
        ? { eps, indexLevel, indexPE, asOf }
        : { eps, patNow, pat3yrAgo, roce3yrAvg, mcap, g: computeGrowth(patNow, pat3yrAgo), ke, asOf },
      band: savedBand,
    })
  }

  const eps = isIndex
    ? deriveIndexEps(existingBand?.index_level ?? null, existingBand?.index_pe ?? null)
    : (existingBand?.eps ?? null)
  const patNow = existingBand?.pat_now ?? null
  const pat3yrAgo = existingBand?.pat_3yr_ago ?? null
  const roce3yrAvg = existingBand?.roce_3yr_avg ?? null
  const mcap = existingBand?.mcap ?? null
  const indexLevel = existingBand?.index_level ?? null
  const indexPE = existingBand?.index_pe ?? null
  const g = computeGrowth(patNow, pat3yrAgo)

  if (!eps || (!isIndex && (patNow == null || pat3yrAgo == null || roce3yrAvg == null || mcap == null))) {
    return NextResponse.json({
      error: `No saved financials for ${upperSymbol}. Use Regen Financials first.`,
    }, { status: 422 })
  }

  if (category === 'Hospitals' && existingCmp && eps && existingCmp / eps > 80) {
    return NextResponse.json({
      error: `PE unreliable (${Math.round(existingCmp / eps)}×) — EV/EBITDA override needed for ${upperSymbol}`,
    }, { status: 422 })
  }

  const result = calculateBands({
    category,
    eps,
    g,
    ke,
    mcap,
    roce3yrAvg,
  })

  if (!result) {
    return NextResponse.json({
      error: `Not enough saved data to compute bands for ${upperSymbol}.`,
    }, { status: 422 })
  }

  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    user_id: user.id,
    symbol: upperSymbol,
    anchor_type: 'PE',
    eps,
    pat_now: patNow,
    pat_3yr_ago: pat3yrAgo,
    roce_3yr_avg: roce3yrAvg,
    mcap,
    index_level: indexLevel,
    index_pe: indexPE,
    buy_low: result.buyLow,
    buy_high: result.buyHigh,
    mid_low: result.midLow,
    mid_high: result.midHigh,
    trim_price: result.trimPrice,
    manual_cmp: existingCmp,
    notes: existingBand?.notes ?? '',
    last_updated_at: now,
    generated_at: now,
  }

  const { data: newBand, error: upsertError } = await supabase
    .from('buy_bands')
    .upsert(payload, { onConflict: 'user_id,symbol' })
    .select()
    .single()

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 })

  let generatedTranches: unknown[] = []

  if (fyId) {
    const [{ data: fy }, { data: fyAlloc }, { data: txns }] = await Promise.all([
      supabase.from('fiscal_years').select('total_budget_inr, unallocated_carryover_inr').eq('id', fyId).single(),
      supabase.from('stock_allocations')
        .select('allocation_pct')
        .eq('user_id', user.id).eq('fy_id', fyId).eq('symbol', upperSymbol)
        .maybeSingle(),
      supabase.from('transactions')
        .select('trade_type, amount')
        .eq('user_id', user.id).eq('symbol', upperSymbol).eq('fy_id', fyId),
    ])

    const allocBudget = (fyAlloc && fy)
      ? (fyAlloc.allocation_pct / 100) * (fy.total_budget_inr + (fy.unallocated_carryover_inr ?? 0))
      : 0
    const netSpent = (txns ?? []).reduce(
      (s: number, t: { trade_type: string; amount: number }) =>
        s + (t.trade_type === 'buy' ? t.amount : -t.amount), 0)
    const remaining = Math.max(0, allocBudget - netSpent)
    const liveCmp: number | null = (await fetchCmp(upperSymbol)) ?? existingCmp
    const rm = existingBand?.risk_multiplier ?? 1
    const prices = computeTranchePrices(result.buyLow * rm, result.buyHigh * rm, liveCmp)
    const amtPerTranche = prices.length > 0 ? remaining / prices.length : 0

    await supabase.from('buy_tranches')
      .delete()
      .eq('user_id', user.id)
      .eq('symbol', upperSymbol)
      .eq('fy_id', fyId)

    const trancheRows = prices.map((price, i) => ({
      user_id: user.id,
      symbol: upperSymbol,
      price,
      qty: amtPerTranche > 0 ? Math.max(1, Math.round(amtPerTranche / price)) : 0,
      sort_order: i + 1,
      fy_id: fyId,
    }))

    const { data: inserted } = await supabase
      .from('buy_tranches')
      .insert(trancheRows)
      .select()

    generatedTranches = inserted ?? []
  }

  revalidateTag('buy_bands', {})
  revalidateTag('buy_tranches', {})

  return NextResponse.json({
    symbol: upperSymbol,
    category,
    mode: action,
    financials: isIndex
      ? { eps, indexLevel, indexPE, asOf: existingBand?.notes ?? '' }
      : { eps, patNow, pat3yrAgo, roce3yrAvg, mcap, g, ke, asOf: existingBand?.notes ?? '' },
    band: newBand,
    result,
    tranches: generatedTranches,
  })
}
