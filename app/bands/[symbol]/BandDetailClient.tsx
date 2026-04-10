'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands, computeTrancheprices, computeTrancheAmounts, CATEGORIES_WITHOUT_QUARTERS } from '@/lib/band-calculator'
import { formatINRFull, formatPrice, formatPriceFine, formatINR } from '@/lib/formatter'
import { getBandSignal } from '@/lib/compute'
import type { BuyBand, BuyTranche, StockAllocation, StockCategory, FiscalYear, StockRow } from '@/lib/types'
import BandBar from '@/components/BandBar'
import QuartersToggle from '@/components/QuartersToggle'
import TrancheSection from '@/components/TrancheSection'
import { BandSignalBadge } from '@/components/SignalBadge'
import { RefreshIcon, SparkleIcon, PencilIcon } from '@/components/icons'
import { revalidateBuyBands } from '@/app/actions'

interface Props {
  symbol: string
  band: BuyBand | null
  allocation: StockAllocation | null
  fyRow: StockRow | null
  allTimeQty: number
  allTimeCost: number
  allTimeAvgCost: number
  tranches: BuyTranche[]
  fyId: string
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
  initialHasKey: boolean
  initialAiProvider: 'gemini' | 'claude'
}

export default function BandDetailClient({
  symbol, band: initialBand, allocation: initialAllocation,
  fyRow, allTimeQty, allTimeCost, allTimeAvgCost,
  tranches: initialTranches,
  fyId, fiscalYears, selectedFY, initialHasKey, initialAiProvider,
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
  const [hasKey, setHasKey]                 = useState(initialHasKey)
  const [aiProvider, setAiProvider]         = useState(initialAiProvider)
  const [showKeyPrompt, setShowKeyPrompt]   = useState(false)
  const [showQInfo, setShowQInfo]           = useState(false)
  const [userId, setUserId]                 = useState<string | null>(null)

  useEffect(() => {
    getSupabaseBrowser().auth.getSession()
      .then(({ data }) => setUserId(data.session?.user?.id ?? null))
  }, [])

  const qMode = allocation?.two_weak_quarters ? 'bear' : allocation?.two_strong_quarters ? 'bull' : 'normal'
  const hasQuarters = allocation && !CATEGORIES_WITHOUT_QUARTERS.has(allocation.category as StockCategory)

  const computed = band ? calculateBands({
    category: allocation?.category as StockCategory,
    twoWeakQuarters: allocation?.two_weak_quarters ?? false,
    twoStrongQuarters: allocation?.two_strong_quarters ?? false,
    eps: band.eps,
  }) : null

  const buyLow    = computed?.buyLow    ?? band?.buy_low    ?? null
  const buyHigh   = computed?.buyHigh   ?? band?.buy_high   ?? null
  const midLow    = computed?.midLow    ?? band?.mid_low    ?? null
  const midHigh   = computed?.midHigh   ?? band?.mid_high   ?? null
  const trimPrice = computed?.trimPrice ?? band?.trim_price ?? null
  const hasBands  = buyLow != null && trimPrice != null
  const signal    = getBandSignal(cmp, buyLow, buyHigh, midHigh, trimPrice)

  const fyRemaining = fyRow?.remaining ?? 0

  // All-time current value (live — updates after CMP refresh)
  const allTimeCurrentValue = cmp != null && allTimeQty > 0
    ? Math.round(allTimeQty) * cmp
    : null
  const allTimeUnrealisedPnL = allTimeCurrentValue != null && allTimeCost > 0
    ? allTimeCurrentValue - allTimeCost
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
          const { data } = await sb.from('buy_bands').insert({
            user_id: user.id, symbol, anchor_type: 'PE',
            manual_cmp: price, is_current: true,
          }).select().single()
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

  async function toggleQuarters(field: 'two_weak_quarters' | 'two_strong_quarters', value: boolean) {
    if (!allocation) return
    const patch: Record<string, boolean> = { [field]: value }
    if (value) patch[field === 'two_weak_quarters' ? 'two_strong_quarters' : 'two_weak_quarters'] = false
    const updated = { ...allocation, ...patch }
    setAllocation(updated)

    const sb = getSupabaseBrowser()
    await sb.from('stock_allocations').update(patch).eq('id', allocation.id)

    if (band?.eps) {
      const result = calculateBands({
        category: updated.category as StockCategory,
        twoWeakQuarters: updated.two_weak_quarters,
        twoStrongQuarters: updated.two_strong_quarters,
        eps: band.eps,
      })
      if (result) {
        await sb.from('buy_bands').update({
          buy_low: result.buyLow, buy_high: result.buyHigh,
          mid_low: result.midLow, mid_high: result.midHigh,
          trim_price: result.trimPrice,
          last_updated_at: new Date().toISOString(),
        }).eq('symbol', symbol).eq('is_current', true)
        setBand(prev => prev ? {
          ...prev,
          buy_low: result.buyLow, buy_high: result.buyHigh,
          mid_low: result.midLow, mid_high: result.midHigh,
          trim_price: result.trimPrice,
        } : prev)
      }
    }
  }

  async function generateTranches() {
    setGeneratingTranches(true)
    try {
      const res = await fetch(`/api/tranches/generate/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyId, remainingInr: fyRemaining }),
      })
      const json = await res.json()
      if (res.ok && json.tranches?.length > 0) setTranches(json.tranches)
    } catch {
      // silently fail
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

  const fyLabel = selectedFY?.label
  const backHref = fyLabel ? `/bands?fy=${encodeURIComponent(fyLabel)}` : '/bands'

  // Financials display based on anchor type
  const financialsRows: { label: string; value: string }[] = []
  if (band) {
    financialsRows.push({ label: 'Anchor', value: band.anchor_type.replace('_', '/') })
    if (band.anchor_type === 'PE' && band.eps != null)
      financialsRows.push({ label: 'EPS', value: formatPrice(band.eps) })
    if (band.anchor_type === 'PB' && band.bvps != null)
      financialsRows.push({ label: 'BVPS', value: formatPrice(band.bvps) })
    if (band.anchor_type === 'EV_EBITDA') {
      if (band.ebitda != null) financialsRows.push({ label: 'EBITDA', value: formatINR(band.ebitda) })
      if (band.net_debt != null) financialsRows.push({ label: 'Net Debt', value: formatINR(band.net_debt) })
      if (band.shares != null) financialsRows.push({ label: 'Shares (Cr)', value: String(band.shares) })
    }
    if (band.anchor_type === 'P_EV' && band.embedded_value != null)
      financialsRows.push({ label: 'Embedded Value', value: formatINR(band.embedded_value) })
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
            Bands
          </button>
          <div className="flex items-center gap-2">
            <span className="text-headline font-semibold">{symbol}</span>
            {signal !== 'unknown' && <BandSignalBadge signal={signal} />}
          </div>
          <div style={{ minWidth: 60 }} />
        </div>
      </div>

      {/* ── Refresh CMP strip ── */}
      <div className="flex items-center justify-end border-b px-4"
        style={{ borderColor: 'var(--border-faint)', minHeight: 40, background: 'var(--bg-primary)' }}>
        <button onClick={refreshCMP} disabled={refreshing}
          className="flex items-center gap-1.5 disabled:opacity-40"
          style={{ color: 'var(--text-muted)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 13, minHeight: 32 }}>
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
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: 4 }}>52W Low</p>
                <p className="text-body font-semibold tabnum">{week52.low != null ? formatPrice(week52.low) : '—'}</p>
              </div>
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: 4 }}>Current Price</p>
                <p style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                  {cmp != null ? formatPrice(cmp) : '—'}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: 4 }}>52W High</p>
                <p className="text-body font-semibold tabnum">{week52.high != null ? formatPrice(week52.high) : '—'}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="h-7 rounded-lg flex items-center px-3 mb-4" style={{ background: 'var(--bg-tertiary)' }}>
            <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>No bands yet — set financials to generate</p>
          </div>
        )}
      </div>

      {/* ── Bear / Normal / Bull + ⓘ ── */}
      {hasQuarters && (
        <div style={{ background: 'var(--bg-primary)', marginTop: 10, padding: '10px 16px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <QuartersToggle
            twoWeakQuarters={allocation!.two_weak_quarters}
            twoStrongQuarters={allocation!.two_strong_quarters}
            onChange={toggleQuarters}
          />
          <button
            onClick={() => setShowQInfo(true)}
            style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', background: 'var(--bg-secondary)', fontSize: 13, fontStyle: 'italic', fontWeight: 700, color: 'var(--text-muted)', cursor: 'pointer' }}>
            i
          </button>
        </div>
      )}
      {genError && <p className="px-4 pt-2 text-subheadline text-negative">{genError}</p>}

      {/* ── Allocation ── */}
      <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
        <SectionHeader label="Allocation" />
        <DetailRow label="Remaining" value={formatINRFull(fyRemaining)} bold />
        <DetailRow label="Invested" value={formatINRFull(fyRow?.currentCost ?? 0)} />
        <DetailRow label="Planned Allocation" value={formatINRFull(fyRow?.budget ?? 0)} muted />
      </div>

      {/* ── Position (all-time holdings) ── */}
      {(allTimeQty > 0 || allTimeCost > 0) && (
        <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
          <SectionHeader label="Position" />
          <DetailRow label="Shares" value={allTimeQty > 0 ? String(Math.round(allTimeQty)) : '—'} />
          <DetailRow label="Avg Cost" value={allTimeAvgCost > 0 ? formatPriceFine(allTimeAvgCost) : '—'} />
          <DetailRow label="Current Value" value={allTimeCurrentValue != null ? formatINRFull(Math.round(allTimeCurrentValue)) : '—'} />
          {allTimeUnrealisedPnL != null && allTimeUnrealisedPnL !== 0 && (
            <DetailRow
              label="Unrealized P&L"
              value={`${allTimeUnrealisedPnL >= 0 ? '+' : ''}${formatINRFull(Math.round(allTimeUnrealisedPnL))}`}
              color={allTimeUnrealisedPnL >= 0 ? 'var(--text-positive)' : 'var(--text-negative)'}
            />
          )}
        </div>
      )}

      {/* ── Financials ── */}
      {(financialsRows.length > 0 || !band) && (
        <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
          <SectionHeader label="Financials">
            <div style={{ display: 'flex', gap: 16 }}>
              <button onClick={generateBands} disabled={generating}
                className="flex items-center gap-1 text-body disabled:opacity-40"
                style={{ color: 'var(--accent)', minHeight: 36 }}>
                <SparkleIcon className="w-3.5 h-3.5" />
                {generating ? 'Generating…' : 'Regen'}
              </button>
            </div>
          </SectionHeader>
          {financialsRows.map(r => (
            <DetailRow key={r.label} label={r.label} value={r.value} />
          ))}
          {financialsRows.length === 0 && (
            <p className="px-4 py-3 text-subheadline" style={{ color: 'var(--text-faint)' }}>
              No financials — tap Regen to generate bands
            </p>
          )}
        </div>
      )}

      {/* ── Buy Levels (inline) ── */}
      <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
        <SectionHeader label="Buy Levels" />
        <TrancheSection
          symbol={symbol}
          tranches={tranches}
          remaining={fyRemaining}
          budget={fyRow?.budget ?? 0}
          hasBands={hasBands}
          cmp={cmp}
          onAdd={(_sym, qty, price) => addTranche(qty, price)}
          onDelete={deleteTranche}
          onUpdate={updateTranche}
          onGenerate={generateTranches}
          onClear={clearAllTranches}
          generating={generatingTranches}
        />
      </div>

      {/* ── Sheets ── */}
      {showKeyPrompt && (
        <KeyPromptSheet
          initialProvider={aiProvider}
          onClose={() => setShowKeyPrompt(false)}
          onSaved={(provider) => { setHasKey(true); setAiProvider(provider) }}
        />
      )}
      {showQInfo && <QuartersInfoSheet onClose={() => setShowQInfo(false)} />}
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

function DetailRow({ label, value, bold, muted, color }: {
  label: string; value: string; bold?: boolean; muted?: boolean; color?: string
}) {
  return (
    <div className="flex items-center justify-between px-4"
      style={{ minHeight: 44, borderBottom: '1px solid var(--border-faint)' }}>
      <span className="text-body" style={{ color: 'var(--text-2)' }}>{label}</span>
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

// ── Quarters Info Sheet ──────────────────────────────────────────────────────

function QuartersInfoSheet({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-14" />
          <p className="font-semibold text-headline">Recent Quarters</p>
          <button onClick={onClose} className="text-accent text-headline w-14 text-right" style={{ minHeight: 44 }}>Done</button>
        </div>
        <div className="px-5 pt-4">
          <p className="text-body leading-relaxed mb-5" style={{ color: 'var(--text-2)' }}>
            Adjusts buy band multiples based on the last 2 quarters of reported results.
          </p>
          {[
            { mode: 'Bear', desc: 'Two recent weak quarters. Buy range compresses to the lower half of standard multiples — you demand deeper discounts before committing.' },
            { mode: 'Normal', desc: 'Base case. Full standard multiples apply. Use when recent quarters are in line with expectations.' },
            { mode: 'Bull', desc: 'Two recent strong quarters. Buy range shifts to premium multiples (where defined) or the upper half of the standard range.' },
          ].map(({ mode, desc }, i, arr) => (
            <div key={mode}>
              <p className="text-body font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{mode}</p>
              <p className="text-subheadline leading-relaxed" style={{ color: 'var(--text-2)' }}>{desc}</p>
              {i < arr.length - 1 && <div className="my-4" style={{ height: 1, background: 'var(--border-faint)' }} />}
            </div>
          ))}
        </div>
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
