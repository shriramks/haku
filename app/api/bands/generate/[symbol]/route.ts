import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { calculateBands, computeTranchePrices } from '@/lib/band-calculator'
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
  return `Open https://www.screener.in/company/${symbol}/consolidated/ — the consolidated financials page for NSE:${symbol}.

From the Profit & Loss table, read the RIGHTMOST non-empty column (most recent period — prefer TTM if shown, else latest annual FY):
- "EPS in Rs" row → EPS per share in ₹. This is rupees per share, NOT crores. Typical range for large/mid-caps: ₹5–₹300.

Self-validation before returning (do not include in output):
- EPS below ₹2 for a large/mid-cap with significant profits almost always means a scale error — recheck.

Return ONLY this JSON, no markdown, no explanation:
{"eps":0,"asOf":""}

asOf = the period label of the data used, e.g. "TTM Mar25" or "FY25"`
}

function indexPrompt(symbol: string): string {
  return `Look up NSE:${symbol} and identify which index it tracks. Then find:
1. The current trailing PE ratio of that index (last 12 months, NOT forward PE). If this is a commodity ETF (gold, silver, etc.) with no earnings, set indexPE to 0.
2. Current market price per unit of NSE:${symbol} in ₹ — latest traded price, NOT the NAV

Sanity check: Trailing PE for Indian equity indices is normally 15–40. If indexPE is 0 it means this is a non-equity ETF.

Return ONLY this JSON, no markdown, no explanation:
{"indexPE":0,"etfPrice":0,"asOf":""}

asOf = brief description including index name and date, e.g. "Nifty Next 50 @ 28.4x PE | Mar 2025" or "Gold ETF — no PE | Mar 2025"`
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
  const rawKey = aiProvider === 'claude'
    ? userSettings?.claude_api_key
    : userSettings?.gemini_api_key
  const activeKey = rawKey ? await decrypt(rawKey) : null

  if (!activeKey) return NextResponse.json({
    error: aiProvider === 'claude'
      ? 'No Claude API key configured. Add your key in Settings (profile icon).'
      : 'No Gemini API key configured. Add your key in Settings (profile icon).',
  }, { status: 500 })

  // Fetch allocation for category + PE adjustment values
  const { data: alloc } = await supabase
    .from('stock_allocations')
    .select('category, quality, stress')
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
  const isIndex     = category === 'Nifty 50 Index' || category === 'Nifty Next 50 Index'
  const isCommodity = category === 'Commodity'

  if (isCommodity) {
    return NextResponse.json({
      error: 'Bands cannot be generated for commodity ETFs — please set price targets manually.',
    }, { status: 422 })
  }

  // Call AI provider with search grounding (retry once on transient failure)
  let aiText: string
  const prompt = isIndex ? indexPrompt(upperSymbol)
    : stockPrompt(upperSymbol)
  const callAI = () => aiProvider === 'claude'
    ? callClaude(prompt, activeKey)
    : callGemini(prompt, activeKey)
  const providerName = aiProvider === 'claude' ? 'Claude' : 'Gemini'
  try {
    aiText = await callAI()
  } catch {
    try {
      // Retry once on transient network failure
      aiText = await callAI()
    } catch (e2: unknown) {
      return NextResponse.json({
        error: `${providerName} fetch failed: ${e2 instanceof Error ? e2.message : String(e2)}`,
      }, { status: 502 })
    }
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
  let eps: number | null = null
  let asOf = String(parsed.asOf ?? '')

  if (isIndex) {
    const indexPE  = Number(parsed.indexPE)  || null
    const etfPrice = Number(parsed.etfPrice) || null

    if (!etfPrice) {
      return NextResponse.json({
        error: 'Could not extract ETF price',
        raw: aiText.slice(0, 600),
      }, { status: 422 })
    }

    if (!indexPE) {
      return NextResponse.json({
        error: `${upperSymbol} appears to be a non-equity ETF (commodity/debt) — PE-based bands don't apply. Set price targets manually.`,
        raw: aiText.slice(0, 600),
      }, { status: 422 })
    }

    eps  = etfPrice / indexPE
    asOf = String(parsed.asOf ?? '')
  } else {
    eps = Number(parsed.eps) || null

    // If eps is missing (AI search miss), retry once
    if (!eps) {
      try {
        const retryText = await callAI()
        const retryParsed = extractJSON(retryText)
        eps = Number(retryParsed.eps) || null
        if (retryParsed.asOf) asOf = String(retryParsed.asOf)
        aiText = retryText
      } catch { /* ignore retry failure, fall through to band calc error */ }
    }
  }

  // Calculate bands
  const result = calculateBands({
    category,
    quality: alloc.quality ?? 0,
    stress:  alloc.stress  ?? 0,
    eps,
  })

  if (!result) {
    return NextResponse.json({
      error: `Not enough data to compute bands for ${upperSymbol}. Got: EPS=${eps}`,
      raw: aiText.slice(0, 600),
    }, { status: 422 })
  }

  // Preserve existing CMP before overwriting
  const { data: existingBand } = await supabase
    .from('buy_bands')
    .select('manual_cmp')
    .eq('user_id', user.id)
    .eq('symbol', upperSymbol)
    .maybeSingle()
  const existingCmp = existingBand?.manual_cmp ?? null

  // Upsert — unique constraint (user_id, symbol) ensures exactly one row per stock
  const now = new Date().toISOString()
  const { data: newBand, error: upsertError } = await supabase
    .from('buy_bands')
    .upsert({
      user_id:    user.id,
      symbol:     upperSymbol,
      anchor_type: 'PE',
      eps,
      buy_low:    result.buyLow,
      buy_high:   result.buyHigh,
      mid_low:    result.midLow,
      mid_high:   result.midHigh,
      trim_price: result.trimPrice,
      manual_cmp: existingCmp,
      notes:      `${result.anchorUsed} | ${asOf}`,
      last_updated_at: now,
      generated_at:    now,
    }, { onConflict: 'user_id,symbol' })
    .select()
    .single()

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  // ── Auto-generate tranches ─────────────────────────────────────────────────
  let generatedTranches: unknown[] = []

  if (fyId) {
    // Compute remaining budget for this stock in this FY
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

    // Fetch live CMP so tranches are never placed above current market price
    const liveCmp: number | null = (await fetchCmp(upperSymbol)) ?? existingCmp

    const prices = computeTranchePrices(result.buyLow, result.buyHigh, liveCmp)
    const amtPerTranche = prices.length > 0 ? remaining / prices.length : 0

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
      sort_order: i + 1,
      fy_id:      fyId,
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
    financials: { eps, asOf },
    band:     newBand,
    result,
    tranches: generatedTranches,
  })
}
