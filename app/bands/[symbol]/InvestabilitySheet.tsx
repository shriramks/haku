'use client'
import { useState, useEffect, useRef } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import type { Investability } from '@/lib/types'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import { ChevronRightIcon } from '@/components/icons'

type GateKey =
  | 'g1_moat'
  | 'g2_owner_earnings'
  | 'g3_capital_efficiency'
  | 'g4_innovation'
  | 'g5_execution_track'
  | 'g6_sector_winds'
  | 'g7_governance'
  | 'g8_supply_regulatory'
  | 'g9_market_cap'
  | 'g10_capital_discipline'

type GateScores = Record<GateKey, number>

const GATES: Array<{ key: GateKey; label: string; desc: string; hardVeto?: boolean }> = [
  { key: 'g1_moat',               label: 'Moat',               desc: 'Durable competitive advantage (5–10y)' },
  { key: 'g2_owner_earnings',     label: 'Owner Earnings',     desc: 'FCF quality and trend' },
  { key: 'g3_capital_efficiency', label: 'Capital Efficiency', desc: 'ROCE / ROE vs sector threshold' },
  { key: 'g4_innovation',         label: 'Innovation',         desc: 'Adaptability, product evolution' },
  { key: 'g5_execution_track',    label: 'Execution Track',    desc: 'Through-cycle delivery' },
  { key: 'g6_sector_winds',       label: 'Sector Winds',       desc: 'Growth durability, margin quality' },
  { key: 'g7_governance',         label: 'Governance',         desc: 'Clean audits, allocation, no red flags', hardVeto: true },
  { key: 'g8_supply_regulatory',  label: 'Supply / Regulatory', desc: 'Concentration, regulatory stability' },
  { key: 'g9_market_cap',         label: 'Market Cap',         desc: 'Re-rating ceiling, EPS growth headroom' },
  { key: 'g10_capital_discipline', label: 'Capital Discipline', desc: 'Buybacks, dividends, acquisition quality' },
]

function emptyGates(): GateScores {
  return {
    g1_moat: 0, g2_owner_earnings: 0, g3_capital_efficiency: 0,
    g4_innovation: 0, g5_execution_track: 0, g6_sector_winds: 0,
    g7_governance: 0, g8_supply_regulatory: 0, g9_market_cap: 0,
    g10_capital_discipline: 0,
  }
}

export default function InvestabilitySheet({ symbol, userId, initialInvestability, onClose, onSaved }: {
  symbol: string
  userId: string | null
  initialInvestability: Investability | null
  onClose: () => void
  onSaved: (inv: Investability) => void
}) {
  const [gates, setGates] = useState<GateScores>(() => {
    if (!initialInvestability) return emptyGates()
    const { g1_moat, g2_owner_earnings, g3_capital_efficiency, g4_innovation,
            g5_execution_track, g6_sector_winds, g7_governance, g8_supply_regulatory,
            g9_market_cap, g10_capital_discipline } = initialInvestability
    return { g1_moat, g2_owner_earnings, g3_capital_efficiency, g4_innovation,
             g5_execution_track, g6_sector_winds, g7_governance, g8_supply_regulatory,
             g9_market_cap, g10_capital_discipline }
  })
  const [rationale, setRationale] = useState<Record<string, string>>(
    initialInvestability?.rationale ?? {}
  )
  const [expandedGates, setExpandedGates] = useState<Set<GateKey>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const totalScore = Object.values(gates).reduce((s, v) => s + v, 0)
  const isInvestable = totalScore >= 20 && gates.g7_governance > 0

  function step(key: GateKey, dir: 1 | -1) {
    const next = { ...gates, [key]: Math.max(0, Math.min(5, gates[key] + dir)) }
    setGates(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => persist(next, rationale), 800)
  }

  async function persist(scores: GateScores, rat: Record<string, string>) {
    if (!userId) return
    const total  = Object.values(scores).reduce((s, v) => s + v, 0)
    const invest = total >= 20 && scores.g7_governance > 0
    const { data } = await getSupabaseBrowser()
      .from('investability')
      .upsert({
        user_id: userId,
        symbol,
        ...scores,
        total_score: total,
        investable: invest,
        rationale: rat,
        assessed_at: new Date().toISOString(),
      }, { onConflict: 'user_id,symbol' })
      .select()
      .single()
    if (data) onSaved(data as Investability)
  }

  async function generate() {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch(`/api/investability/generate/${symbol}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setGenError(json.error ?? 'Generation failed')
        return
      }
      const inv = json.investability as Investability
      const { g1_moat, g2_owner_earnings, g3_capital_efficiency, g4_innovation,
              g5_execution_track, g6_sector_winds, g7_governance, g8_supply_regulatory,
              g9_market_cap, g10_capital_discipline } = inv
      setGates({ g1_moat, g2_owner_earnings, g3_capital_efficiency, g4_innovation,
                 g5_execution_track, g6_sector_winds, g7_governance, g8_supply_regulatory,
                 g9_market_cap, g10_capital_discipline })
      setRationale(inv.rationale ?? {})
      onSaved(inv)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <BottomSheet onClose={onClose} className="overflow-y-auto max-h-[90vh]">
      <SheetHeader
        title={
          <div className="flex flex-col items-center" style={{ gap: 1 }}>
            <span className="text-footnote font-semibold" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>{symbol}</span>
            <span className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>Investability</span>
          </div>
        }
        left={null}
        right={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Done</button>}
      />
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Total Score</p>
            <p className="text-title-1 font-bold tabnum" style={{ color: 'var(--text-primary)' }}>
              {totalScore}<span className="text-body font-normal" style={{ color: 'var(--text-muted)' }}>/50</span>
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Verdict</p>
            <p className={`text-title-2 font-bold ${isInvestable ? 'text-positive' : 'text-negative'}`}>
              {isInvestable ? 'Investable' : 'Not Investable'}
            </p>
          </div>
        </div>
        <p className="px-5 pb-3 text-subheadline" style={{ color: 'var(--text-muted)' }}>
          Scale of 0-5, with 5 being best in class.
        </p>

        <button
          onClick={generate}
          disabled={generating}
          className="flex items-center justify-between w-full px-5"
          style={{
            minHeight: 52,
            background: generating
              ? 'color-mix(in srgb, var(--accent) 4%, var(--bg-secondary))'
              : 'color-mix(in srgb, var(--accent) 7%, var(--bg-secondary))',
            opacity: generating ? 0.7 : 1,
          }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-lg text-accent"
              style={{ width: 32, height: 32, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)', fontSize: 15 }}>
              {generating ? '…' : '✦'}
            </div>
            <div style={{ textAlign: 'left' }}>
              <p className="text-body font-medium" style={{ color: 'var(--accent)' }}>
                {generating ? 'Analysing with Gemini…' : (Object.keys(rationale).length > 0 ? 'Regenerate' : 'Generate with AI')}
              </p>
              {!generating && (
                <p className="text-footnote" style={{ color: 'var(--text-muted)' }}>
                  {Object.keys(rationale).length > 0 ? 'AI-scored · tap to refresh' : 'Gemini scores all 10 gates'}
                </p>
              )}
            </div>
          </div>
          <ChevronRightIcon className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        </button>

        {genError && (
          <p className="px-5 pt-3 text-subheadline text-negative">{genError}</p>
        )}

        <p className="px-5 pb-2 text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em', paddingTop: 14 }}>
          Gates
        </p>

        {GATES.map(({ key, label, desc }) => {
          const isExpanded = expandedGates.has(key)
          const hasRationale = !!rationale[key]
          const toggleExpand = () => {
            if (!hasRationale) return
            setExpandedGates(prev => {
              const next = new Set(prev)
              next.has(key) ? next.delete(key) : next.add(key)
              return next
            })
          }
          return (
            <div key={key}>
              <div className="flex items-center justify-between px-5" style={{ minHeight: 56 }}>
                <button
                  onClick={toggleExpand}
                  disabled={!hasRationale}
                  className="flex-1 min-w-0 pr-3 text-left disabled:opacity-100"
                  style={{ minHeight: 44 }}>
                  <div className="flex items-center gap-1.5">
                    <p className="text-body" style={{ color: 'var(--text-primary)' }}>
                      {label}
                    </p>
                    {hasRationale && (
                      <ChevronRightIcon
                        className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        style={{ color: isExpanded ? 'var(--accent)' : 'var(--text-muted)' }}
                      />
                    )}
                  </div>
                  {!hasRationale && (
                    <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                  )}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => step(key, -1)}
                    style={{ width: 44, height: 44, borderRadius: 12, background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-tertiary))', border: '1px solid color-mix(in srgb, var(--accent) 20%, var(--border))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 300, color: 'var(--accent)', minHeight: 44, minWidth: 44 }}>
                    −
                  </button>
                  <span className="tabnum font-semibold text-headline" style={{ minWidth: 28, textAlign: 'center', color: gates[key] > 0 ? 'var(--text-primary)' : 'var(--text-2)' }}>
                    {gates[key]}
                  </span>
                  <button
                    onClick={() => step(key, +1)}
                    style={{ width: 44, height: 44, borderRadius: 12, background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-tertiary))', border: '1px solid color-mix(in srgb, var(--accent) 20%, var(--border))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 300, color: 'var(--accent)', minHeight: 44, minWidth: 44 }}>
                    +
                  </button>
                </div>
              </div>
              {isExpanded && hasRationale && (
                <p className="text-subheadline px-5 pb-3" style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>
                  {rationale[key]}
                </p>
              )}
            </div>
          )
        })}
    </BottomSheet>
  )
}
