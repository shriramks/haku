import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { decrypt } from '@/lib/encrypt'

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']

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
          signal: AbortSignal.timeout(60_000),
        }
      )
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      continue
    }
    if (res.status === 503 || res.status === 429 || res.status === 404) {
      lastErr = new Error(`Gemini ${res.status}: ${await res.text()}`)
      continue
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const parts: Array<{ text?: string; thought?: boolean }> = data.candidates?.[0]?.content?.parts ?? []
    const textParts = parts.filter(p => p.text && !p.thought)
    return (textParts.map(p => p.text).join('') || parts[0]?.text) ?? ''
  }
  throw new Error(`Gemini fetch failed: ${lastErr.message}`)
}

function extractJSON(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON block found in response')
  return JSON.parse(text.slice(start, end + 1))
}

function investabilityPrompt(symbol: string): string {
  return `You are a disciplined equity analyst scoring NSE:${symbol} on a 10-gate investability framework.

Use web search to research the company — check screener.in, annual reports, news, and analyst commentary. Then score each gate from 0 (worst) to 5 (best in class).

Gates to score:
1. g1_moat — Durable competitive advantage (5–10 year horizon)
2. g2_owner_earnings — FCF quality and trend
3. g3_capital_efficiency — ROCE / ROE vs sector threshold
4. g4_innovation — Adaptability, product evolution
5. g5_execution_track — Through-cycle delivery track record
6. g6_sector_winds — Growth durability, margin quality
7. g7_governance — Score via 3 forensic checks (max 5). Any veto = 0, hard fail.
   Check 1 – Cash conversion (OCF/PAT, 3yr avg): >70%=+2, 50-70%=+1, <50%=0, <30%=VETO.
   Check 2 – Related-party exposure (RPT value/revenue, latest AR): <2%=+2, 2-5%=+1, >5%=0, loans to promoters=VETO.
   Check 3 – Promoter holding trend (last 8 quarters): stable/increasing=+1, <3% decline=0, 3-5% decline=0, >5% decline in any 18-month window=VETO.
   Flag in rationale if promoter pledge >30%. Return the integer sum (0–5).
8. g8_supply_regulatory — Supply concentration, regulatory stability
9. g9_market_cap — Re-rating ceiling, EPS growth headroom
10. g10_capital_discipline — Buybacks, dividends, acquisition quality

Return ONLY this JSON, no markdown, no explanation:
{
  "g1_moat": 0, "g1_moat_r": "one sentence rationale",
  "g2_owner_earnings": 0, "g2_owner_earnings_r": "one sentence rationale",
  "g3_capital_efficiency": 0, "g3_capital_efficiency_r": "one sentence rationale",
  "g4_innovation": 0, "g4_innovation_r": "one sentence rationale",
  "g5_execution_track": 0, "g5_execution_track_r": "one sentence rationale",
  "g6_sector_winds": 0, "g6_sector_winds_r": "one sentence rationale",
  "g7_governance": 0, "g7_governance_r": "one sentence rationale",
  "g8_supply_regulatory": 0, "g8_supply_regulatory_r": "one sentence rationale",
  "g9_market_cap": 0, "g9_market_cap_r": "one sentence rationale",
  "g10_capital_discipline": 0, "g10_capital_discipline_r": "one sentence rationale"
}`
}

const GATE_KEYS = [
  'g1_moat', 'g2_owner_earnings', 'g3_capital_efficiency', 'g4_innovation',
  'g5_execution_track', 'g6_sector_winds', 'g7_governance', 'g8_supply_regulatory',
  'g9_market_cap', 'g10_capital_discipline',
] as const

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const upperSymbol = symbol.toUpperCase()

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('gemini_api_key')
    .eq('user_id', user.id)
    .maybeSingle()

  const rawKey = userSettings?.gemini_api_key
  const key = rawKey ? await decrypt(rawKey) : null
  if (!key) {
    return NextResponse.json(
      { error: 'No Gemini API key configured. Add your key in Settings.' },
      { status: 500 }
    )
  }

  const prompt = investabilityPrompt(upperSymbol)
  let aiText: string
  try {
    aiText = await callGemini(prompt, key)
  } catch {
    try {
      aiText = await callGemini(prompt, key)
    } catch (e2) {
      return NextResponse.json(
        { error: `Gemini fetch failed: ${e2 instanceof Error ? e2.message : String(e2)}` },
        { status: 502 }
      )
    }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = extractJSON(aiText)
  } catch {
    return NextResponse.json(
      { error: 'Could not parse JSON from Gemini response', raw: aiText.slice(0, 600) },
      { status: 502 }
    )
  }

  const scores: Record<string, number> = {}
  const rationale: Record<string, string> = {}
  for (const key of GATE_KEYS) {
    scores[key] = Math.min(5, Math.max(0, Math.round(Number(parsed[key]) || 0)))
    rationale[key] = String(parsed[`${key}_r`] ?? '')
  }

  const totalScore = Object.values(scores).reduce((s, v) => s + v, 0)
  const investable = totalScore >= 20 && scores.g7_governance > 0

  const { data, error } = await supabase
    .from('investability')
    .upsert({
      user_id: user.id,
      symbol: upperSymbol,
      ...scores,
      total_score: totalScore,
      investable,
      rationale,
      assessed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,symbol' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ investability: data })
}
