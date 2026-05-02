'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import {
  DEFAULT_ERP,
  calculateBands,
  computeGrowth,
  deriveIndexEps,
  getCostOfEquity,
  getRoceThreshold,
  getSizeMod,
  getSizeModValueLabel,
  INDEX_CATEGORIES,
  isBandStale,
} from '@/lib/band-calculator'
import { formatINRFullNum, formatPriceNum } from '@/lib/formatter'
import type { BuyBand, BuyTranche, StockAllocation, StockCategory, StockRow, Investability } from '@/lib/types'
import BandBar from '@/components/BandBar'
import TrancheSection from '@/components/TrancheSection'
import { RefreshIcon, SparkleIcon, ChevronRightIcon } from '@/components/icons'
import { revalidateBuyBands } from '@/app/actions'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'

interface Props {
  symbol: string
  band: BuyBand | null
  allocation: StockAllocation | null
  fyRow: StockRow | null
  allTimeQty: number
  allTimeCost: number
  tranches: BuyTranche[]
  fyId: string
  fyLabel: string
  backHref: string
  backLabel: string
  initialHasKey: boolean
  initialAiProvider: 'gemini' | 'claude'
  initialInvestability: Investability | null
}

export default function BandDetailClient({
  symbol, band: initialBand, allocation: initialAllocation,
  fyRow, allTimeQty, allTimeCost,
  tranches: initialTranches,
  fyId, fyLabel, backHref, backLabel, initialHasKey, initialAiProvider,
  initialInvestability,
}: Props) {
  const router = useRouter()
  const [band, setBand]               = useState(initialBand)
  const [allocation]                  = useState(initialAllocation)
  const [tranches, setTranches]       = useState(initialTranches)
  const [cmp, setCmp]                 = useState(initialBand?.manual_cmp ?? null)
  const [week52, setWeek52]           = useState<{ low: number | null; high: number | null }>({
    low: initialBand?.week_52_low ?? null,
    high: initialBand?.week_52_high ?? null,
  })
  const [refreshing, setRefreshing]         = useState(false)
  const [generating, setGenerating]         = useState(false)
  const [refreshingFinancials, setRefreshingFinancials] = useState(false)
  const [genError, setGenError]             = useState('')
  const [generatingTranches, setGeneratingTranches] = useState(false)
  const [trancheGenError, setTrancheGenError]       = useState('')
  const [hasKey, setHasKey]                 = useState(initialHasKey)
  const [aiProvider, setAiProvider]         = useState(initialAiProvider)
  const [showKeyPrompt, setShowKeyPrompt]   = useState(false)
  const [showFinancials, setShowFinancials] = useState(false)
  const [showTranches, setShowTranches]     = useState(false)
  const [showComputation, setShowComputation] = useState(false)
  const [showInvestability, setShowInvestability] = useState(false)
  const [investability, setInvestability]   = useState(initialInvestability)
  const [userId, setUserId]                 = useState<string | null>(null)

  useEffect(() => {
    getSupabaseBrowser().auth.getSession()
      .then(({ data }) => setUserId(data.session?.user?.id ?? null))
  }, [])

  const buyLow    = band?.buy_low    ?? null
  const buyHigh   = band?.buy_high   ?? null
  const midLow    = band?.mid_low    ?? null
  const midHigh   = band?.mid_high   ?? null
  const trimPrice = band?.trim_price ?? null
  const hasBands  = buyLow != null && trimPrice != null
  const staleBands = isBandStale(band?.generated_at, band?.last_updated_at)

  const fyRemaining = fyRow?.remaining ?? 0
  const isIndex = INDEX_CATEGORIES.has(allocation?.category as StockCategory)
  const financialSummary = isIndex ? '2 inputs' : '5 inputs'

  const allTimeCurrentValue = cmp != null && allTimeQty > 0
    ? Math.round(allTimeQty) * cmp
    : null

  async function refreshCMP() {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/cmp/${encodeURIComponent(symbol)}`)
      if (!res.ok) throw new Error('fetch failed')
      const { price, week52Low, week52High } = await res.json()
      setCmp(price)
      setWeek52({ low: week52Low ?? null, high: week52High ?? null })
      const sb = getSupabaseBrowser()
      if (band) {
        await sb.from('buy_bands').update({
          manual_cmp: price,
          week_52_low: week52Low ?? null,
          week_52_high: week52High ?? null,
        }).eq('id', band.id)
        setBand(prev => prev ? { ...prev, manual_cmp: price, week_52_low: week52Low ?? null, week_52_high: week52High ?? null } : prev)
        revalidateBuyBands()
      } else {
        const { data: { user } } = await sb.auth.getUser()
        if (user) {
          const { data } = await sb.from('buy_bands').upsert({
            user_id: user.id, symbol, anchor_type: 'PE',
            manual_cmp: price,
          }, { onConflict: 'user_id,symbol' }).select().single()
          if (data) setBand(data)
        }
      }
    } catch {
      // silently fail
    } finally {
      setRefreshing(false)
    }
  }

  async function runBandAction(action: 'bands' | 'financials') {
    if (action === 'financials' && !hasKey) { setShowKeyPrompt(true); return }
    if (action === 'bands') setGenerating(true)
    if (action === 'financials') setRefreshingFinancials(true)
    setGenError('')
    try {
      const res = await fetch(`/api/bands/generate/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyId, action }),
      })
      const json = await res.json()
      if (!res.ok) {
        setGenError(json.error ?? 'Generation failed')
      } else if (json.band) {
        setBand(json.band)
        setCmp(json.band.manual_cmp ?? cmp)
        if (action === 'bands' && json.tranches?.length > 0) setTranches(json.tranches)
      }
    } catch {
      setGenError('Network error')
    }
    if (action === 'bands') setGenerating(false)
    if (action === 'financials') setRefreshingFinancials(false)
  }

  async function generateBands() {
    await runBandAction('bands')
  }

  async function refreshFinancials() {
    await runBandAction('financials')
  }

  async function generateTranches() {
    setGeneratingTranches(true)
    setTrancheGenError('')
    try {
      const res = await fetch(`/api/tranches/generate/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyId, remainingInr: fyRemaining }),
      })
      const json = await res.json()
      if (!res.ok) {
        setTrancheGenError(json.error ?? 'Generation failed')
      } else if (json.tranches?.length > 0) {
        setTranches(json.tranches)
      } else {
        setTrancheGenError('No tranches returned — check remaining budget')
      }
    } catch {
      setTrancheGenError('Network error — try again')
    }
    setGeneratingTranches(false)
  }

  async function addTranche(qty: number, price: number) {
    if (!userId) return
    const { data } = await getSupabaseBrowser().from('buy_tranches').insert({
      user_id: userId, symbol, qty, price,
      sort_order: tranches.length + 1, fy_id: fyId,
    }).select().single()
    if (data) setTranches(prev => [...prev, data].sort((a, b) => b.price - a.price))
  }

  async function updateTranche(id: string, qty: number, price: number) {
    setTranches(prev => prev.map(t => t.id === id ? { ...t, qty, price } : t))
    await getSupabaseBrowser().from('buy_tranches').update({ qty, price }).eq('id', id)
  }

  async function deleteTranche(id: string) {
    await getSupabaseBrowser().from('buy_tranches').delete().eq('id', id)
    setTranches(prev => prev.filter(t => t.id !== id))
  }

  async function clearAllTranches() {
    await getSupabaseBrowser().from('buy_tranches').delete().eq('symbol', symbol).eq('fy_id', fyId)
    setTranches([])
  }

  return (
    <div style={{ minHeight: '100dvh', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

      {/* ── Nav ── */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b"
        style={{ background: 'var(--bg-nav)', borderColor: 'var(--border)', paddingTop: 'max(env(safe-area-inset-top,0px), 16px)' }}>
        <div className="flex items-center justify-between px-4 pb-3">
          <button onClick={() => router.push(backHref)}
            className="flex items-center gap-1 text-body flex-shrink-0"
            style={{ color: 'var(--accent)', minWidth: 60, minHeight: 44 }}>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M7 1L1 7l6 6" /></svg>
            {backLabel}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-headline font-semibold">{symbol}</span>
          </div>
          <div style={{ minWidth: 60 }} />
        </div>
      </div>

      {/* ── CMP / Regen strip ── */}
      <div className="flex items-center justify-between border-b px-4 gap-2"
        style={{ borderColor: 'var(--border-faint)', minHeight: 40, background: 'var(--bg-primary)' }}>
        <button onClick={generateBands} disabled={generating}
          className="flex items-center gap-1.5 disabled:opacity-40 text-accent text-subheadline rounded-lg px-2.5 py-1.5"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', minHeight: 32 }}>
          <SparkleIcon className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Generating…' : 'Regen Bands'}
        </button>
        <button onClick={refreshCMP} disabled={refreshing}
          className="flex items-center gap-1.5 disabled:opacity-40 text-accent text-subheadline rounded-lg px-2.5 py-1.5"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', minHeight: 32 }}>
          <RefreshIcon className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh CMP'}
        </button>
      </div>

      {/* ── Band bar ── */}
      <div style={{ background: 'var(--bg-primary)', padding: '14px 16px 0' }}>
        <p className="text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em', marginBottom: 10 }}>Buy Band</p>
        {hasBands ? (
          <>
            <BandBar
              buyLow={buyLow!} buyHigh={buyHigh!}
              midLow={midLow!} midHigh={midHigh!}
              trimPrice={trimPrice!} cmp={cmp}
            />
            {/* ── 52W Low | CMP | 52W High ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr', alignItems: 'center', padding: '12px 0 14px', borderTop: '1px solid var(--border-faint)', marginTop: 8, gap: 8 }}>
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: 4 }}>52W Low <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-faint)' }}>₹</span></p>
                <p className="text-title-2 font-semibold tabnum">{week52.low != null ? formatPriceNum(week52.low) : '—'}</p>
              </div>
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: 4 }}>Current Price <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-faint)' }}>₹</span></p>
                <p style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                  {cmp != null ? String(parseFloat(cmp.toFixed(2))) : '—'}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: 4 }}>52W High <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-faint)' }}>₹</span></p>
                <p className="text-title-2 font-semibold tabnum">{week52.high != null ? formatPriceNum(week52.high) : '—'}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="h-7 rounded-lg flex items-center px-3 mb-4" style={{ background: 'var(--bg-tertiary)' }}>
            <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>No bands yet — set financials to generate</p>
          </div>
        )}
      </div>

      {/* ── Investability row ── */}
      <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
        <button
          onClick={() => setShowInvestability(true)}
          className="flex items-center justify-between w-full px-4 py-3"
          style={{ minHeight: 56 }}>
          <div style={{ textAlign: 'left' }}>
            <p className="text-body" style={{ color: 'var(--text-2)' }}>Investability</p>
            {!investability && (
              <p className="text-subheadline" style={{ color: 'var(--text-faint)', marginTop: 2 }}>
                Run the 10-gate scorecard
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {investability ? (
              <span
                className="tabnum text-subheadline font-semibold"
                style={{
                  color: investability.investable ? 'var(--positive)' : 'var(--warning)',
                  background: investability.investable
                    ? 'color-mix(in srgb, var(--positive) 10%, transparent)'
                    : 'color-mix(in srgb, var(--warning) 10%, transparent)',
                  border: `1px solid ${investability.investable
                    ? 'color-mix(in srgb, var(--positive) 20%, transparent)'
                    : 'color-mix(in srgb, var(--warning) 20%, transparent)'}`,
                  borderRadius: 999,
                  minHeight: 28,
                  padding: '0 10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}>
                {investability.total_score}/50 {investability.investable ? '✓' : ''}
              </span>
            ) : (
              <span
                className="text-subheadline font-medium"
                style={{
                  color: 'var(--accent)',
                  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
                  borderRadius: 12,
                  minHeight: 44,
                  padding: '0 14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}>
                Assess
              </span>
            )}
            <ChevronRightIcon className="w-4 h-4" style={{ color: 'var(--text-faint)' }} />
          </div>
        </button>
      </div>

      {genError && <p className="px-4 pt-2 text-subheadline text-negative">{genError}</p>}

      {/* ── Allocation + Position ── */}
      <div style={{ marginTop: 10, background: 'var(--bg-primary)' }}>
        <p className="text-footnote font-semibold uppercase px-4" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em', paddingTop: 14, paddingBottom: 10 }}>Allocation</p>
        <DetailRow label="Remaining Allocation" value={formatINRFullNum(fyRemaining)} bold />
        <DetailRow label={`Invested ${fyLabel}`} value={formatINRFullNum(fyRow?.spent ?? 0)} />
        <DetailRow label="Invested Total" value={formatINRFullNum(allTimeCost)} />
        {allTimeCurrentValue != null && (
          <DetailRow label="Current Value" value={formatINRFullNum(Math.round(allTimeCurrentValue))} />
        )}
        {allTimeQty > 0 && (
          <DetailRow label="Shares Held" value={String(allTimeQty)} noRupee />
        )}
      </div>

      {/* ── Financials row → sheet ── */}
      <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
        <button
          onClick={() => setShowFinancials(true)}
          className="flex items-center justify-between w-full px-4"
          style={{ minHeight: 44 }}>
          <span className="text-body" style={{ color: 'var(--text-2)' }}>Financials</span>
          <div className="flex items-center gap-2">
            <span className="text-subheadline" style={{ color: 'var(--text-faint)' }}>
              {financialSummary}
            </span>
            <span className="text-body text-accent">›</span>
          </div>
        </button>
      </div>

      <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
        <button
          onClick={() => setShowComputation(true)}
          className="flex items-center justify-between w-full px-4"
          style={{ minHeight: 44 }}>
          <span className="text-body" style={{ color: 'var(--text-2)' }}>Band Computation</span>
          <div className="flex items-center gap-2">
            <span className="text-subheadline" style={{ color: staleBands ? 'var(--warning)' : 'var(--text-faint)' }}>
              {staleBands ? 'Bands need regen' : 'Path, factor, formula'}
            </span>
            <span className="text-body text-accent">›</span>
          </div>
        </button>
      </div>

      {/* ── Buy Levels row → sheet ── */}
      <div className="px-4" style={{ marginTop: 10 }}>
        <button
          onClick={() => setShowTranches(true)}
          className="flex items-center justify-center gap-1.5 w-full rounded-2xl text-body font-semibold"
          style={{ minHeight: 48, background: 'color-mix(in srgb, var(--accent) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', color: 'var(--accent)' }}>
          Buy Levels
          <span style={{ opacity: 0.6 }}>›</span>
        </button>
      </div>

      {/* ── Sheets ── */}
      {showKeyPrompt && (
        <KeyPromptSheet
          initialProvider={aiProvider}
          onClose={() => setShowKeyPrompt(false)}
          onSaved={(provider) => { setHasKey(true); setAiProvider(provider) }}
        />
      )}
      {showFinancials && (
        <FinancialsSheet
          symbol={symbol}
          band={band}
          allocation={allocation}
          generating={generating}
          refreshingFinancials={refreshingFinancials}
          genError={genError}
          onGenerateBands={generateBands}
          onRefreshFinancials={refreshFinancials}
          onBandSaved={b => setBand(b)}
          onClose={() => setShowFinancials(false)}
        />
      )}
      {showComputation && (
        <BandComputationSheet
          band={band}
          allocation={allocation}
          onClose={() => setShowComputation(false)}
        />
      )}
      {showTranches && (
        <TranchesSheet
          symbol={symbol}
          tranches={tranches}
          remaining={fyRemaining}
          budget={fyRow?.budget ?? 0}
          hasBands={hasBands}
          cmp={cmp}
          generating={generatingTranches}
          genError={trancheGenError}
          onAdd={(_sym, qty, price) => addTranche(qty, price)}
          onDelete={deleteTranche}
          onUpdate={updateTranche}
          onGenerate={generateTranches}
          onClear={clearAllTranches}
          onClose={() => setShowTranches(false)}
        />
      )}
      {showInvestability && (
        <InvestabilitySheet
          symbol={symbol}
          userId={userId}
          initialInvestability={investability}
          onClose={() => setShowInvestability(false)}
          onSaved={inv => setInvestability(inv)}
        />
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function DetailRow({ label, value, bold, muted, color, noRupee }: {
  label: string; value: string; bold?: boolean; muted?: boolean; color?: string; noRupee?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4"
      style={{ minHeight: 44 }}>
      <span className="text-body" style={{ color: 'var(--text-2)' }}>
        {label} {!noRupee && <span style={{ color: 'var(--text-faint)' }}>₹</span>}
      </span>
      <span className="tabnum" style={{
        fontSize: bold ? 17 : 15,
        fontWeight: bold ? 700 : 400,
        color: color ?? (muted ? 'var(--text-muted)' : 'var(--text-primary)'),
      }}>
        {value}
      </span>
    </div>
  )
}

// ── Financials Sheet ─────────────────────────────────────────────────────────

function FinancialsSheet({ symbol, band, allocation, generating, refreshingFinancials, genError, onGenerateBands, onRefreshFinancials, onBandSaved, onClose }: {
  symbol: string
  band: BuyBand | null
  allocation: StockAllocation | null
  generating: boolean
  refreshingFinancials: boolean
  genError: string
  onGenerateBands: () => void
  onRefreshFinancials: () => void
  onBandSaved: (b: BuyBand) => void
  onClose: () => void
}) {
  const isIndex = INDEX_CATEGORIES.has(allocation?.category as StockCategory)
  const [saving, setSaving]         = useState(false)
  const [saveFeedback, setSaveFeedback] = useState<{ tone: 'positive' | 'negative'; message: string } | null>(null)
  const [eps, setEps]               = useState(band?.eps?.toString() ?? '')
  const [patNow, setPatNow]         = useState(band?.pat_now?.toString() ?? '')
  const [pat3yrAgo, setPat3yrAgo]   = useState(band?.pat_3yr_ago?.toString() ?? '')
  const [roce3yrAvg, setRoce3yrAvg] = useState(band?.roce_3yr_avg?.toString() ?? '')
  const [mcap, setMcap]             = useState(band?.mcap?.toString() ?? '')
  const [indexLevel, setIndexLevel] = useState(band?.index_level?.toString() ?? '')
  const [indexPe, setIndexPe]       = useState(band?.index_pe?.toString() ?? '')
  const kh = useKeyboardHeight()
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
  }, [])

  useEffect(() => {
    setEps(band?.eps?.toString() ?? '')
    setPatNow(band?.pat_now?.toString() ?? '')
    setPat3yrAgo(band?.pat_3yr_ago?.toString() ?? '')
    setRoce3yrAvg(band?.roce_3yr_avg?.toString() ?? '')
    setMcap(band?.mcap?.toString() ?? '')
    setIndexLevel(band?.index_level?.toString() ?? '')
    setIndexPe(band?.index_pe?.toString() ?? '')
  }, [band])

  async function save() {
    setSaving(true)
    setSaveFeedback(null)
    try {
      const sb = getSupabaseBrowser()
      const indexLevelVal = parseFloat(indexLevel) || null
      const indexPeVal    = parseFloat(indexPe) || null
      const derivedIndexEps = deriveIndexEps(indexLevelVal, indexPeVal)
      const fields: Record<string, unknown> = {
        eps: isIndex ? derivedIndexEps : (parseFloat(eps) || null),
        last_updated_at: new Date().toISOString(),
      }
      if (!isIndex) {
        fields.pat_now      = parseFloat(patNow) || null
        fields.pat_3yr_ago  = parseFloat(pat3yrAgo) || null
        fields.roce_3yr_avg = parseFloat(roce3yrAvg) || null
        fields.mcap         = parseFloat(mcap) || null
      } else {
        fields.index_level = parseFloat(indexLevel) || null
        fields.index_pe    = parseFloat(indexPe) || null
      }

      let savedBand: BuyBand | null = null
      if (band) {
        const { data, error } = await sb.from('buy_bands').update(fields).eq('id', band.id).select().single()
        if (error) throw error
        savedBand = data
      } else {
        const { data: { user } } = await sb.auth.getUser()
        if (!user) throw new Error('Missing user session')
        const { data, error } = await sb.from('buy_bands').upsert({
          user_id: user.id, symbol, anchor_type: 'PE', ...fields,
        }, { onConflict: 'user_id,symbol' }).select().single()
        if (error) throw error
        savedBand = data
      }

      if (!savedBand) throw new Error('Save returned no data')
      onBandSaved(savedBand)
      setSaveFeedback({ tone: 'positive', message: 'Financials saved' })
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = setTimeout(() => setSaveFeedback(null), 1800)
    } catch {
      setSaveFeedback({ tone: 'negative', message: 'Failed to save financials' })
    }
    setSaving(false)
  }

  const indexLevelVal = parseFloat(indexLevel) || null
  const indexPeVal    = parseFloat(indexPe) || null
  const derivedIndexEps = deriveIndexEps(indexLevelVal, indexPeVal)

  const staleBands = isBandStale(band?.generated_at, band?.last_updated_at)

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div
           className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl flex flex-col overflow-hidden sheet-kb"
           style={{
             bottom: kh,
             background: 'var(--bg-secondary)',
             maxHeight: kh > 0
               ? `calc(100dvh - ${kh}px - max(env(safe-area-inset-top,0px), 16px))`
               : '85dvh',
           }}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="w-14" />
          <p className="font-semibold text-headline">Financials</p>
          <button onClick={onClose} className="text-accent text-headline w-14 text-right" style={{ minHeight: 44 }}>Done</button>
        </div>
        <div
          className="overflow-y-auto"
          style={{ paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
          <div className="px-5 pt-4">
            <div className="flex gap-2 mb-4">
              <button onClick={onGenerateBands} disabled={generating}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl flex-1 text-body font-medium disabled:opacity-40"
                style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)' }}>
                <SparkleIcon className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                {generating ? 'Regenerating…' : 'Regen Bands'}
              </button>
              <button onClick={onRefreshFinancials} disabled={refreshingFinancials}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl flex-1 text-body font-medium disabled:opacity-40"
                style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)' }}>
                <RefreshIcon className={`w-4 h-4 ${refreshingFinancials ? 'animate-spin' : ''}`} />
                {refreshingFinancials ? 'Refreshing…' : 'Regen Financials'}
              </button>
            </div>
            {genError && <p className="text-subheadline text-negative mb-3">{genError}</p>}
            {staleBands && (
              <p className="text-subheadline mb-3" style={{ color: 'var(--warning)' }}>
                Financials changed. Regen Bands to apply.
              </p>
            )}
            <p className="text-subheadline mb-3" style={{ color: 'var(--text-faint)' }}>
              {allocation?.category ? `${allocation.category} · ` : ''}PE
            </p>
            <div className="flex flex-col gap-3 mb-4">
              {!isIndex ? (
                <>
                  <FinInput label="EPS (₹)" value={eps} onChange={setEps} placeholder="e.g. 18" />
                  <FinInput label="PAT Now (Cr)" value={patNow} onChange={setPatNow} placeholder="e.g. 5200" />
                  <FinInput label="PAT 3yr Ago (Cr)" value={pat3yrAgo} onChange={setPat3yrAgo} placeholder="e.g. 3800" />
                  <FinInput label="ROCE 3yr Avg (%)" value={roce3yrAvg} onChange={setRoce3yrAvg} placeholder="e.g. 36.8" />
                  <FinInput label="Mcap (Cr)" value={mcap} onChange={setMcap} placeholder="e.g. 18737" />
                </>
              ) : (
                <>
                  <FinInput label="Index Level" value={indexLevel} onChange={setIndexLevel} placeholder="e.g. 22500" />
                  <FinInput label="Index PE" value={indexPe} onChange={setIndexPe} placeholder="e.g. 22" />
                  <FinReadOnly
                    label="Implied EPS (₹)"
                    value={derivedIndexEps != null ? derivedIndexEps.toFixed(2) : '—'}
                  />
                </>
              )}
            </div>
            <button onClick={save} disabled={saving}
              className="w-full mt-1 py-4 rounded-xl text-headline font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#FFFFFF' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveFeedback && (
              <p
                className="text-subheadline mt-3 text-center"
                style={{ color: saveFeedback.tone === 'positive' ? 'var(--positive)' : 'var(--negative)' }}>
                {saveFeedback.message}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function FinInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="text-subheadline block mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <input type="number" inputMode="decimal" placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={e => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
        className="w-full px-3.5 py-3.5 rounded-xl text-headline tabnum outline-none"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
    </div>
  )
}

function FinReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-subheadline block mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <div
        className="w-full px-3.5 py-3.5 rounded-xl text-headline tabnum"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
        {value}
      </div>
    </div>
  )
}

function CompRow({ k, v, faint, first }: { k: string; v: string; faint?: boolean; first?: boolean }) {
  return (
    <div className="flex items-center justify-between" style={{ minHeight: 44, borderTop: first ? 'none' : '1px solid var(--border-faint)' }}>
      <span style={{ fontSize: faint ? 13 : 15, color: faint ? 'var(--text-faint)' : 'var(--text-2)' }}>{k}</span>
      <span className="tabnum" style={{ fontSize: faint ? 13 : 15, color: faint ? 'var(--text-faint)' : 'var(--text-primary)', fontWeight: 400, textAlign: 'right' }}>{v}</span>
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="text-footnote" style={{ color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, paddingTop: 16, paddingBottom: 2 }}>
      {label}
    </p>
  )
}

function MarketCapRuleModal({ mcap, onClose }: { mcap: number | null; onClose: () => void }) {
  const applied = mcap != null ? getSizeMod(mcap) : null
  const brackets = [
    { label: '< 50k Cr',    value: 1.00 },
    { label: '50k – 1L Cr', value: 0.97 },
    { label: '1L – 2L Cr',  value: 0.94 },
    { label: '≥ 2L Cr',     value: 0.90 },
  ]
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60" onClick={onClose} />
      <div className="fixed inset-x-8 top-1/2 z-[60] rounded-2xl p-5" style={{ background: 'var(--bg-secondary)', transform: 'translateY(-50%)' }}>
        <p className="text-headline font-semibold text-center mb-1">Market Cap Rule</p>
        {brackets.map((b, i) => {
          const active = b.value === applied
          return (
            <div key={b.value} className="flex items-center justify-between" style={{ minHeight: 44, borderTop: i === 0 ? 'none' : '1px solid var(--border-faint)' }}>
              <span className="text-body" style={{ color: active ? 'var(--text-primary)' : 'var(--text-faint)' }}>{b.label}</span>
              <span className="text-body tabnum" style={{ color: active ? 'var(--text-primary)' : 'var(--text-faint)', fontWeight: active ? 600 : 400 }}>{b.value.toFixed(2)}</span>
            </div>
          )
        })}
        <button onClick={onClose} className="w-full mt-2 text-accent text-body" style={{ minHeight: 44 }}>Done</button>
      </div>
    </>
  )
}

function MarketCapRuleRow({ mcap }: { mcap: number | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="flex items-center justify-between w-full" style={{ minHeight: 44, borderTop: '1px solid var(--border-faint)' }} onClick={() => setOpen(true)}>
        <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>Market Cap Rule</span>
        <span className="tabnum" style={{ fontSize: 15, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 3 }}>
          {getSizeModValueLabel(mcap)}
          <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>›</span>
        </span>
      </button>
      {open && <MarketCapRuleModal mcap={mcap} onClose={() => setOpen(false)} />}
    </>
  )
}

function BandComputationSheet({ band, allocation, onClose }: {
  band: BuyBand | null
  allocation: StockAllocation | null
  onClose: () => void
}) {
  const isIndex = INDEX_CATEGORIES.has(allocation?.category as StockCategory)
  const [riskFree, setRiskFree] = useState(0.07)

  useEffect(() => {
    getSupabaseBrowser()
      .from('user_settings')
      .select('risk_free')
      .maybeSingle()
      .then(({ data }) => { if (data?.risk_free != null) setRiskFree(data.risk_free) })
  }, [])

  const epsVal       = band?.eps ?? null
  const patNowVal    = band?.pat_now ?? null
  const pat3yrAgoVal = band?.pat_3yr_ago ?? null
  const roceVal      = band?.roce_3yr_avg ?? null
  const mcapVal      = band?.mcap ?? null
  const g = computeGrowth(patNowVal, pat3yrAgoVal)
  const ke = getCostOfEquity(riskFree)
  const staleBands = isBandStale(band?.generated_at, band?.last_updated_at)
  const computationResult = (epsVal && allocation?.category)
    ? calculateBands({
        category: allocation.category as StockCategory,
        eps: epsVal,
        g,
        ke,
        mcap: mcapVal,
        roce3yrAvg: roceVal,
      })
    : null

  const roceThreshold = allocation?.category
    ? getRoceThreshold(allocation.category as StockCategory)
    : null

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl overflow-y-auto"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)', maxHeight: '85vh' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-14" />
          <p className="font-semibold text-headline">Band Computation</p>
          <button onClick={onClose} className="text-accent text-headline w-14 text-right" style={{ minHeight: 44 }}>Done</button>
        </div>
        <div className="px-5 pt-4">
          {staleBands && (
            <p className="text-subheadline mb-3" style={{ color: 'var(--warning)' }}>
              Financials changed. Regen Bands to apply.
            </p>
          )}
          {!computationResult ? (
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
              <p className="text-body" style={{ color: 'var(--text-2)' }}>
                Save financials first to inspect the current band calculation.
              </p>
            </div>
          ) : (
            <>
              <div>
                <CompRow k="Category" v={allocation?.category ?? '—'} first />

                {!isIndex && <SectionLabel label="Growth" />}
                {!isIndex && <CompRow k="g" v={g != null ? `${(g * 100).toFixed(1)}%` : '—'} />}
                {!isIndex && <CompRow k="g Definition" v="3-year PAT CAGR" faint />}

                <SectionLabel label="Cost of Equity" />
                <CompRow k="Risk-free Value" v={`${(riskFree * 100).toFixed(1)}%`} />
                <CompRow k="Risk-free Definition" v="India 10Y govt bond yield" faint />
                <CompRow k="Equity Risk Premium" v={`${(DEFAULT_ERP * 100).toFixed(1)}% (fixed)`} />
                <CompRow k="Ke (Cost of Equity)" v={`${(ke * 100).toFixed(1)}%`} />
                <CompRow k="Ke Definition" v="Risk-free + ERP" faint />

                {!isIndex && <SectionLabel label="Factor" />}
                {!isIndex && computationResult.path === 'B' && <CompRow k="Factor (base)" v="1.00" />}
                {!isIndex && computationResult.path === 'B' && <MarketCapRuleRow mcap={mcapVal} />}
                {!isIndex && computationResult.path === 'B' && <CompRow k="Factor after size" v={computationResult.factorBase.toFixed(3)} />}
                {!isIndex && <CompRow k="ROCE Value" v={roceVal != null ? `${roceVal.toFixed(1)}%` : '—'} faint />}
                {!isIndex && <CompRow k="ROCE Threshold" v={roceThreshold != null ? `${roceThreshold.toFixed(1)}%` : '—'} faint />}
                {!isIndex && <CompRow k="ROCE Rule" v="ROCE > 2 × threshold" faint />}
                {!isIndex && <CompRow k="ROCE Premium" v={computationResult.rocePremium ? 'Yes — factor boosted ×1.15' : 'No — factor unchanged'} faint />}
                {!isIndex && <CompRow k="Final Factor" v={computationResult.factor.toFixed(3)} />}

                <SectionLabel label="Output" />
                <CompRow k="Band Formula" v="PE multiple × factor × EPS" />
                {allocation?.category === 'Hospitals' && <CompRow k="Hospital Guard" v="Stop if CMP / EPS > 80x" />}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ── Tranches Sheet ────────────────────────────────────────────────────────────

function TranchesSheet({ symbol, tranches, remaining, budget, hasBands, cmp, generating, genError,
  onAdd, onDelete, onUpdate, onGenerate, onClear, onClose }: {
  symbol: string
  tranches: BuyTranche[]
  remaining: number
  budget: number
  hasBands: boolean
  cmp: number | null
  generating: boolean
  genError: string
  onAdd: (symbol: string, qty: number, price: number) => Promise<void>
  onDelete: (id: string) => void
  onUpdate: (id: string, qty: number, price: number) => Promise<void>
  onGenerate: () => void
  onClear: () => Promise<void>
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl overflow-y-auto"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)', maxHeight: '85vh' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-14" />
          <p className="font-semibold text-headline">Buy Levels</p>
          <button onClick={onClose} className="text-accent text-headline w-14 text-right" style={{ minHeight: 44 }}>Done</button>
        </div>
        {genError && (
          <p className="px-5 pt-3 text-subheadline text-negative">{genError}</p>
        )}
        <TrancheSection
          symbol={symbol}
          tranches={tranches}
          remaining={remaining}
          budget={budget}
          hasBands={hasBands}
          cmp={cmp}
          onAdd={onAdd}
          onDelete={onDelete}
          onUpdate={onUpdate}
          onGenerate={onGenerate}
          onClear={onClear}
          generating={generating}
          hideHeader
        />
      </div>
    </>
  )
}

// ── Investability Sheet ───────────────────────────────────────────────────────

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
  { key: 'g1_moat' as const,                label: 'Moat',                 desc: 'Durable competitive advantage (5–10y)' },
  { key: 'g2_owner_earnings' as const,      label: 'Owner Earnings',       desc: 'FCF quality and trend' },
  { key: 'g3_capital_efficiency' as const,  label: 'Capital Efficiency',   desc: 'ROCE / ROE vs sector threshold' },
  { key: 'g4_innovation' as const,          label: 'Innovation',           desc: 'Adaptability, product evolution' },
  { key: 'g5_execution_track' as const,     label: 'Execution Track',      desc: 'Through-cycle delivery' },
  { key: 'g6_sector_winds' as const,        label: 'Sector Winds',         desc: 'Growth durability, margin quality' },
  { key: 'g7_governance' as const,          label: 'Governance',           desc: 'Clean audits, allocation, no red flags', hardVeto: true },
  { key: 'g8_supply_regulatory' as const,   label: 'Supply / Regulatory',  desc: 'Concentration, regulatory stability' },
  { key: 'g9_market_cap' as const,          label: 'Market Cap',           desc: 'Re-rating ceiling, EPS growth headroom' },
  { key: 'g10_capital_discipline' as const, label: 'Capital Discipline',   desc: 'Buybacks, dividends, acquisition quality' },
]

function emptyGates(): GateScores {
  return {
    g1_moat: 0, g2_owner_earnings: 0, g3_capital_efficiency: 0,
    g4_innovation: 0, g5_execution_track: 0, g6_sector_winds: 0,
    g7_governance: 0, g8_supply_regulatory: 0, g9_market_cap: 0,
    g10_capital_discipline: 0,
  }
}

function InvestabilitySheet({ symbol, userId, initialInvestability, onClose, onSaved }: {
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
    timerRef.current = setTimeout(() => persist(next), 800)
  }

  async function persist(scores: GateScores) {
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
        assessed_at: new Date().toISOString(),
      }, { onConflict: 'user_id,symbol' })
      .select()
      .single()
    if (data) onSaved(data as Investability)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl overflow-y-auto"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)', maxHeight: '90vh' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-14" />
          <p className="font-semibold text-headline">Investability</p>
          <button onClick={onClose} className="text-accent text-headline w-14 text-right" style={{ minHeight: 44 }}>Done</button>
        </div>
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center justify-between rounded-2xl px-4 py-3"
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
            <div>
              <p className="text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Total Score</p>
              <p className="text-title-1 font-bold tabnum" style={{ color: 'var(--text-primary)' }}>
                {totalScore}<span className="text-body font-normal" style={{ color: 'var(--text-faint)' }}>/50</span>
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Verdict</p>
              <p className="text-title-2 font-bold" style={{ color: isInvestable ? 'var(--positive)' : 'var(--negative)' }}>
                {isInvestable ? 'Investable' : 'Not Investable'}
              </p>
            </div>
          </div>
        </div>
        <p className="px-5 pb-2 text-subheadline" style={{ color: 'var(--text-faint)' }}>
          Scale of 0-5, with 5 being best in class. Scores autosave as you adjust them.
        </p>
        <p className="px-5 pb-2 text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>
          Gates
        </p>

        {/* Gate rows */}
        {GATES.map(({ key, label, desc, hardVeto }) => (
          <div key={key} style={{ borderTop: '1px solid var(--border-faint)' }}>
            <div className="flex items-center justify-between px-5"
              style={{ minHeight: 56 }}>
              <div className="flex-1 min-w-0 pr-3">
                <p className="text-body" style={{ color: gates[key] > 0 ? 'var(--text-primary)' : 'var(--text-2)' }}>
                  {label}
                  {hardVeto && <span className="ml-1.5 text-footnote" style={{ color: 'var(--negative)' }}>hard veto</span>}
                </p>
                <p className="text-footnote" style={{ color: 'var(--text-faint)' }}>{desc}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => step(key, -1)}
                  style={{ width: 44, height: 44, borderRadius: 12, background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-tertiary))', border: '1px solid color-mix(in srgb, var(--accent) 20%, var(--border))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 300, color: 'var(--accent)', minHeight: 44, minWidth: 44 }}>
                  −
                </button>
                <span className="tabnum font-semibold" style={{ fontSize: 17, minWidth: 28, textAlign: 'center', color: gates[key] > 0 ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                  {gates[key]}
                </span>
                <button
                  onClick={() => step(key, +1)}
                  style={{ width: 44, height: 44, borderRadius: 12, background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-tertiary))', border: '1px solid color-mix(in srgb, var(--accent) 20%, var(--border))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 300, color: 'var(--accent)', minHeight: 44, minWidth: 44 }}>
                  +
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ── AI Key Prompt Sheet ──────────────────────────────────────────────────────

function KeyPromptSheet({ initialProvider, onClose, onSaved }: {
  initialProvider: 'gemini' | 'claude'
  onClose: () => void
  onSaved: (provider: 'gemini' | 'claude') => void
}) {
  const [provider, setProvider] = useState<'gemini' | 'claude'>(initialProvider)
  const [key, setKey]           = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim(), provider }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to save'); setSaving(false); return }
      onSaved(provider)
      onClose()
    } catch {
      setError('Network error')
    }
    setSaving(false)
  }

  const placeholder = provider === 'claude' ? 'sk-ant-…' : 'AIzaSy…'
  const keyLink     = provider === 'claude' ? 'console.anthropic.com' : 'aistudio.google.com'

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>
          <p className="font-semibold text-headline">AI API Key</p>
          <button onClick={save} disabled={saving || !key.trim()}
            className="text-accent text-headline font-semibold disabled:opacity-40"
            style={{ minHeight: 44 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div className="px-5 pt-4 space-y-4">
          <div className="flex rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
            {(['gemini', 'claude'] as const).map(p => (
              <button key={p} type="button" onClick={() => { setProvider(p); setKey(''); setError('') }}
                className="flex-1 py-3 text-body font-medium transition-colors"
                style={provider === p
                  ? { background: '#0A84FF', color: '#fff' }
                  : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {p === 'gemini' ? 'Google Gemini' : 'Claude'}
              </button>
            ))}
          </div>
          {provider === 'gemini' && (
            <p className="text-subheadline text-center text-positive">
              ★ Recommended — best accuracy for live financial data
            </p>
          )}
          <input
            type="password" placeholder={placeholder} value={key}
            onChange={e => setKey(e.target.value)}
            className="w-full px-4 py-3.5 rounded-2xl text-headline outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            autoFocus
          />
          {error && <p className="text-negative text-subheadline">{error}</p>}
          <div className="rounded-2xl p-3.5"
               style={{ background: 'rgba(10,132,255,0.07)', border: '1px solid rgba(10,132,255,0.18)' }}>
            <p className="text-subheadline leading-relaxed" style={{ color: 'var(--text-2)' }}>
              <span className="font-semibold text-accent">Stored securely.</span>{' '}
              Your API key lives in your database and is locked to your login via row-level security.
              Band generation runs entirely on the server — your browser never sees the key again after you save it.
            </p>
          </div>
          <p className="text-subheadline text-center" style={{ color: 'var(--text-muted)' }}>
            Get a key at <span className="text-accent">{keyLink}</span>
          </p>
        </div>
      </div>
    </>
  )
}
