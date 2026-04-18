'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands } from '@/lib/band-calculator'
import { formatINRFull, formatINRFullNum, formatPrice, formatPriceNum, formatINR } from '@/lib/formatter'
import type { BuyBand, BuyTranche, StockAllocation, StockCategory, StockRow } from '@/lib/types'
import BandBar from '@/components/BandBar'
import TrancheSection from '@/components/TrancheSection'
import { RefreshIcon, SparkleIcon, PencilIcon } from '@/components/icons'
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
}

export default function BandDetailClient({
  symbol, band: initialBand, allocation: initialAllocation,
  fyRow, allTimeQty, allTimeCost,
  tranches: initialTranches,
  fyId, fyLabel, backHref, backLabel, initialHasKey, initialAiProvider,
}: Props) {
  const router = useRouter()
  const [band, setBand]               = useState(initialBand)
  const [allocation, setAllocation]   = useState(initialAllocation)
  const [tranches, setTranches]       = useState(initialTranches)
  const [cmp, setCmp]                 = useState(initialBand?.manual_cmp ?? null)
  const [week52, setWeek52]           = useState<{ low: number | null; high: number | null }>({
    low: initialBand?.week_52_low ?? null,
    high: initialBand?.week_52_high ?? null,
  })
  const [refreshing, setRefreshing]         = useState(false)
  const [generating, setGenerating]         = useState(false)
  const [genError, setGenError]             = useState('')
  const [generatingTranches, setGeneratingTranches] = useState(false)
  const [trancheGenError, setTrancheGenError]       = useState('')
  const [hasKey, setHasKey]                 = useState(initialHasKey)
  const [aiProvider, setAiProvider]         = useState(initialAiProvider)
  const [showKeyPrompt, setShowKeyPrompt]   = useState(false)
  const [showFinancials, setShowFinancials] = useState(false)
  const [showTranches, setShowTranches]     = useState(false)
  const [userId, setUserId]                 = useState<string | null>(null)

  useEffect(() => {
    getSupabaseBrowser().auth.getSession()
      .then(({ data }) => setUserId(data.session?.user?.id ?? null))
  }, [])

  const computed = band ? calculateBands({
    category: allocation?.category as StockCategory,
    quality:  allocation?.quality ?? 0,
    stress:   allocation?.stress  ?? 0,
    eps:      band.eps,
  }) : null

  const buyLow    = computed?.buyLow    ?? band?.buy_low    ?? null
  const buyHigh   = computed?.buyHigh   ?? band?.buy_high   ?? null
  const midLow    = computed?.midLow    ?? band?.mid_low    ?? null
  const midHigh   = computed?.midHigh   ?? band?.mid_high   ?? null
  const trimPrice = computed?.trimPrice ?? band?.trim_price ?? null
  const hasBands  = buyLow != null && trimPrice != null

  const fyRemaining = fyRow?.remaining ?? 0

  // All-time current value (live — updates after CMP refresh)
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
          last_updated_at: new Date().toISOString(),
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

  async function generateBands() {
    if (!hasKey) { setShowKeyPrompt(true); return }
    setGenerating(true)
    setGenError('')
    try {
      const res = await fetch(`/api/bands/generate/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setGenError(json.error ?? 'Generation failed')
      } else if (json.band) {
        setBand(json.band)
        setCmp(json.band.manual_cmp ?? cmp)
        if (json.tranches?.length > 0) setTranches(json.tranches)
      }
    } catch {
      setGenError('Network error')
    }
    setGenerating(false)
  }

  function applyQualityStress(quality: number, stress: number) {
    if (!allocation) return
    setAllocation(prev => prev ? { ...prev, quality, stress } : prev)
  }

  async function persistQualityStress(quality: number, stress: number) {
    if (!allocation) return
    const sb = getSupabaseBrowser()
    await sb.from('stock_allocations').update({ quality, stress }).eq('id', allocation.id)
    if (band?.eps) {
      const result = calculateBands({
        category: allocation.category as StockCategory,
        quality, stress, eps: band.eps,
      })
      if (result) {
        await sb.from('buy_bands').update({
          buy_low: result.buyLow, buy_high: result.buyHigh,
          mid_low: result.midLow, mid_high: result.midHigh,
          trim_price: result.trimPrice,
          last_updated_at: new Date().toISOString(),
        }).eq('symbol', symbol)
      }
    }
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
                  {cmp != null ? formatPriceNum(cmp) : '—'}
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

      {/* ── PE Band Adjustments (Quality / Stress) ── */}
      {allocation && (
        <div style={{ marginTop: 10 }}>
          <QualityStressControl
            initialQuality={allocation.quality ?? 0}
            initialStress={allocation.stress ?? 0}
            onApply={applyQualityStress}
            onPersist={persistQualityStress}
          />
        </div>
      )}
      {genError && <p className="px-4 pt-2 text-subheadline text-negative">{genError}</p>}

      {/* ── Allocation + Position ── */}
      <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
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
          style={{ minHeight: 44, borderBottom: '1px solid var(--border-faint)' }}>
          <span className="text-body" style={{ color: 'var(--text-2)' }}>Financials</span>
          <span className="text-body text-accent">Edit ›</span>
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
          fyId={fyId}
          generating={generating}
          genError={genError}
          onGenerate={generateBands}
          onBandSaved={b => setBand(b)}
          onClose={() => setShowFinancials(false)}
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
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function SectionHeader({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4"
      style={{ minHeight: 36, borderBottom: '1px solid var(--border-faint)' }}>
      <span className="text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function DetailRow({ label, value, bold, muted, color, noRupee }: {
  label: string; value: string; bold?: boolean; muted?: boolean; color?: string; noRupee?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4"
      style={{ minHeight: 44, borderBottom: '1px solid var(--border-faint)' }}>
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

function FinancialsSheet({ symbol, band, allocation, fyId, generating, genError, onGenerate, onBandSaved, onClose }: {
  symbol: string
  band: BuyBand | null
  allocation: StockAllocation | null
  fyId: string
  generating: boolean
  genError: string
  onGenerate: () => void
  onBandSaved: (b: BuyBand) => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [eps, setEps]         = useState(band?.eps?.toString() ?? '')
  const kh = useKeyboardHeight()

  // Sync inputs when band updates (e.g. after AI generation)
  useEffect(() => {
    if (!editing) {
      setEps(band?.eps?.toString() ?? '')
    }
  }, [band, editing])

  async function save() {
    setSaving(true)
    const sb = getSupabaseBrowser()
    const fields = {
      eps:             parseFloat(eps) || null,
      last_updated_at: new Date().toISOString(),
    }
    let savedBand: BuyBand | null = null
    if (band) {
      const { data } = await sb.from('buy_bands').update(fields).eq('id', band.id).select().single()
      savedBand = data
    } else {
      const { data: { user } } = await sb.auth.getUser()
      if (user) {
        const { data } = await sb.from('buy_bands').upsert({
          user_id: user.id, symbol, anchor_type: 'PE', ...fields,
        }, { onConflict: 'user_id,symbol' }).select().single()
        savedBand = data
      }
    }
    if (savedBand) { onBandSaved(savedBand); setEditing(false) }
    setSaving(false)
  }

  const hasData = !!band?.eps

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl overflow-y-auto sheet-kb"
           style={{ bottom: kh, background: 'var(--bg-secondary)', paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 24px)', maxHeight: '85vh' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-14" />
          <p className="font-semibold text-headline">Financials</p>
          <button onClick={onClose} className="text-accent text-headline w-14 text-right" style={{ minHeight: 44 }}>Done</button>
        </div>
        <div className="px-5 pt-4">
          <button onClick={onGenerate} disabled={generating}
            className="flex items-center gap-2 px-4 py-3 rounded-xl w-full mb-4 text-body font-medium disabled:opacity-40"
            style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)' }}>
            <SparkleIcon className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Generating…' : 'Regen from AI'}
          </button>
          {genError && <p className="text-subheadline text-negative mb-3">{genError}</p>}
          {editing ? (
            <>
              <p className="text-subheadline mb-3" style={{ color: 'var(--text-faint)' }}>
                {allocation?.category ? `${allocation.category} · ` : ''}PE
              </p>
              <div className="flex flex-col gap-1 mb-4">
                <label className="text-subheadline" style={{ color: 'var(--text-muted)' }}>EPS (₹)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 18" value={eps}
                  onChange={e => setEps(e.target.value)}
                  className="w-full px-3.5 py-3.5 rounded-xl text-headline tabnum outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
              <button onClick={save} disabled={saving}
                className="w-full mt-2 py-4 rounded-xl text-headline font-semibold disabled:opacity-40"
                style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)}
                className="w-full mt-2 py-3 rounded-xl text-body"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
            </>
          ) : hasData ? (
            <>
              <div className="mb-4">
                <FinItem k="EPS" v={`₹${band?.eps}`} />
              </div>
              <button onClick={() => setEditing(true)}
                className="flex items-center gap-2 px-4 py-3 rounded-xl w-full text-body"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                <PencilIcon className="w-4 h-4" />
                Edit values
              </button>
            </>
          ) : (
            <>
              <p className="text-subheadline mb-4" style={{ color: 'var(--text-faint)' }}>
                No data — tap Regen to auto-fill, or Edit to enter manually
              </p>
              <button onClick={() => setEditing(true)}
                className="flex items-center gap-2 px-4 py-3 rounded-xl w-full text-body"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                <PencilIcon className="w-4 h-4" />
                Enter manually
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function FinItem({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>{k}</p>
      <p className="font-semibold tabnum text-body" style={{ color: 'var(--text-primary)' }}>{v}</p>
    </div>
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

// ── Quality / Stress Control ─────────────────────────────────────────────────

function QualityStressControl({
  initialQuality,
  initialStress,
  onApply,
  onPersist,
}: {
  initialQuality: number
  initialStress: number
  onApply: (quality: number, stress: number) => void
  onPersist: (quality: number, stress: number) => Promise<void>
}) {
  const [quality, setQuality] = useState(initialQuality)
  const [stress, setStress]   = useState(initialStress)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(timerRef.current), [])

  function step(field: 'quality' | 'stress', dir: 1 | -1) {
    const nextQuality = field === 'quality' ? Math.max(0, Math.min(50, quality + dir * 5)) : quality
    const nextStress  = field === 'stress'  ? Math.max(0, Math.min(50, stress  + dir * 5)) : stress
    setQuality(nextQuality)
    setStress(nextStress)
    onApply(nextQuality, nextStress)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onPersist(nextQuality, nextStress), 800)
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center',
    padding: '0 16px 0 0', minHeight: 48,
  }
  const barStyle = (active: boolean): React.CSSProperties => ({
    width: 3, minHeight: 48, alignSelf: 'stretch', flexShrink: 0, marginRight: 14,
    borderRadius: '0 2px 2px 0',
    background: active ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.07)',
    transition: 'background 200ms',
  })

  return (
    <div style={{ background: 'var(--bg-primary)', borderTop: '1px solid var(--border-faint)', borderBottom: '1px solid var(--border-faint)' }}>
      <div className="flex items-center justify-between px-4" style={{ paddingTop: 8, paddingBottom: 6 }}>
        <span className="text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>
          PE Band Adjustments
        </span>
        <InfoPopover>
          <p className="text-subheadline leading-relaxed mb-3" style={{ color: 'var(--text-2)' }}>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Quality ↑</span>
            {' '}(0–50%): raises all band prices — use when you'd pay a premium vs. the sector average.
          </p>
          <p className="text-subheadline leading-relaxed" style={{ color: 'var(--text-2)' }}>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Stress ↓</span>
            {' '}(0–50%): lowers all band prices — use to discount earnings in a realistic bad scenario.
          </p>
        </InfoPopover>
      </div>

      {/* Quality row */}
      <div style={{ ...rowStyle, borderTop: '1px solid var(--border-faint)' }}>
        <div style={barStyle(quality > 0)} />
        <div className="flex items-center gap-1.5 flex-1">
          <span style={{ fontSize: 14, color: quality > 0 ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.22)', transition: 'color 200ms', width: 14, textAlign: 'center' }}>↑</span>
          <span className="text-body" style={{ color: quality > 0 ? 'var(--text-primary)' : 'var(--text-2)', transition: 'color 200ms' }}>Quality</span>
        </div>
        <div className="flex-1 flex justify-center">
          <span className="tabnum" style={{ fontSize: 17, fontWeight: 600, color: quality > 0 ? 'var(--text-primary)' : 'var(--text-faint)', transition: 'color 200ms', minWidth: 40, textAlign: 'center' }}>
            {quality}%
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => step('quality', -1)} style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 300, color: 'var(--text-muted)', minHeight: 44, minWidth: 44 }}>−</button>
          <button onClick={() => step('quality', +1)} style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 300, color: 'var(--text-muted)', minHeight: 44, minWidth: 44 }}>+</button>
        </div>
      </div>

      {/* Stress row */}
      <div style={{ ...rowStyle, borderTop: '1px solid var(--border-faint)' }}>
        <div style={barStyle(stress > 0)} />
        <div className="flex items-center gap-1.5 flex-1">
          <span style={{ fontSize: 14, color: stress > 0 ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.22)', transition: 'color 200ms', width: 14, textAlign: 'center' }}>↓</span>
          <span className="text-body" style={{ color: stress > 0 ? 'var(--text-primary)' : 'var(--text-2)', transition: 'color 200ms' }}>Stress</span>
        </div>
        <div className="flex-1 flex justify-center">
          <span className="tabnum" style={{ fontSize: 17, fontWeight: 600, color: stress > 0 ? 'var(--text-primary)' : 'var(--text-faint)', transition: 'color 200ms', minWidth: 40, textAlign: 'center' }}>
            {stress}%
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => step('stress', -1)} style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 300, color: 'var(--text-muted)', minHeight: 44, minWidth: 44 }}>−</button>
          <button onClick={() => step('stress', +1)} style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 300, color: 'var(--text-muted)', minHeight: 44, minWidth: 44 }}>+</button>
        </div>
      </div>
    </div>
  )
}

function InfoPopover({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', background: 'var(--bg-secondary)', fontSize: 11, fontStyle: 'italic', fontWeight: 700, color: 'var(--text-muted)', cursor: 'pointer' }}>
        i
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 rounded-2xl p-4"
            style={{ bottom: 'calc(100% + 8px)', right: 0, width: 260, background: 'var(--bg-secondary)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,.4)' }}>
            {children}
          </div>
        </>
      )}
    </div>
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
