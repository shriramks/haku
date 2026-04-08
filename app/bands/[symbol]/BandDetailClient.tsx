'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands, computeTrancheprices, computeTrancheAmounts, CATEGORIES_WITHOUT_QUARTERS } from '@/lib/band-calculator'
import { formatINR, formatPrice } from '@/lib/formatter'
import type { BuyBand, BuyTranche, StockAllocation, StockCategory, FiscalYear, StockRow } from '@/lib/types'
import BandBar from '@/components/BandBar'
import { RefreshIcon, SparkleIcon, PencilIcon, TrashIcon, PlusIcon, CheckIcon, ChevronDownIcon } from '@/components/icons'
import { revalidateBuyBands } from '@/app/actions'

interface Props {
  symbol: string
  band: BuyBand | null
  allocation: StockAllocation | null
  fyRow: StockRow | null
  allTimeLeft: number
  tranches: BuyTranche[]
  fyId: string
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
  initialHasKey: boolean
  initialAiProvider: 'gemini' | 'claude'
}

export default function BandDetailClient({
  symbol, band: initialBand, allocation: initialAllocation,
  fyRow, allTimeLeft, tranches: initialTranches,
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
  const [showTranches, setShowTranches]     = useState(false)
  const [showQMode, setShowQMode]           = useState(false)
  const [showQInfo, setShowQInfo]           = useState(false)
  const [addingTranche, setAddingTranche]   = useState(false)
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

  const plannedTotal = tranches.reduce((s, t) => s + t.qty * t.price, 0)
  const fyRemaining = fyRow?.remaining ?? 0
  const remainingAfterTranches = fyRemaining - plannedTotal

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
    }
    setRefreshing(false)
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
        body: JSON.stringify({
          fyId,
          remainingInr: fyRemaining,
          userLiquidInr: selectedFY?.deploy_capital_inr ?? fyRemaining,
        }),
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
      {/* Nav */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between px-4 pb-3">
          <button onClick={() => router.push(backHref)}
            className="flex items-center gap-1 text-body flex-shrink-0"
            style={{ color: 'var(--accent)', minWidth: 60 }}>
            <svg width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 1L1 8l7 7" />
            </svg>
            Bands
          </button>
          <span className="text-headline font-semibold">{symbol}</span>
          <div style={{ minWidth: 60 }} />
        </div>
      </div>

      {/* CMP hero */}
      <div style={{ background: 'var(--bg-primary)', padding: '18px 20px 16px' }}>
        <p className="tabnum" style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {cmp != null ? formatPrice(cmp) : '—'}
        </p>
        <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-faint)' }}>Current Market Price</p>
      </div>

      {/* Section 1: Band bar + 52W */}
      <div style={{ background: 'var(--bg-primary)', marginTop: 10, padding: '14px 20px' }}>
        <p className="text-footnote font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>
          Buy Band
        </p>
        {hasBands ? (
          <>
            <BandBar
              buyLow={buyLow!} buyHigh={buyHigh!}
              midLow={midLow!} midHigh={midHigh!}
              trimPrice={trimPrice!} cmp={cmp}
            />
            {(week52.low != null || week52.high != null) && (
              <div className="flex justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--border-faint)' }}>
                <div>
                  <p className="text-footnote font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>52W Low</p>
                  <p className="text-body font-semibold tabnum mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    {week52.low != null ? formatPrice(week52.low) : '—'}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p className="text-footnote font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>52W High</p>
                  <p className="text-body font-semibold tabnum mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    {week52.high != null ? formatPrice(week52.high) : '—'}
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>No bands yet — tap Regen Bands to generate</p>
        )}
      </div>

      {/* Section 2: Actions (Refresh CMP, Regen Bands) + Bear/Bull toggle */}
      <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
        <div style={{ minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
          <button onClick={refreshCMP} disabled={refreshing}
            className="flex items-center gap-1.5 text-body disabled:opacity-40"
            style={{ color: 'var(--accent)', minHeight: 44 }}>
            <RefreshIcon className="w-4 h-4" />
            {refreshing ? 'Refreshing…' : 'Refresh CMP'}
          </button>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <button onClick={generateBands} disabled={generating}
            className="flex items-center gap-1.5 text-body disabled:opacity-40"
            style={{ color: 'var(--accent)', minHeight: 44 }}>
            <SparkleIcon className="w-4 h-4" />
            {generating ? 'Generating…' : 'Regen Bands'}
          </button>
        </div>
        {hasQuarters && (
          <div className="flex items-center gap-2 px-5 pb-3 pt-1" style={{ borderTop: '1px solid var(--border-faint)' }}>
            <span className="text-subheadline flex-shrink-0" style={{ color: 'var(--text-faint)', marginRight: 4 }}>Recent quarters</span>
            {(['bear', 'normal', 'bull'] as const).map(m => (
              <button key={m} onClick={() => {
                if (m === qMode) return
                if (m === 'bear') toggleQuarters('two_weak_quarters', true)
                else if (m === 'bull') toggleQuarters('two_strong_quarters', true)
                else if (allocation?.two_weak_quarters) toggleQuarters('two_weak_quarters', false)
                else toggleQuarters('two_strong_quarters', false)
              }}
                className="text-subheadline font-semibold"
                style={{
                  padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', minHeight: 32,
                  ...(m === qMode
                    ? m === 'bear'
                      ? { background: 'rgba(255,149,0,0.14)', color: '#C07200' }
                      : m === 'bull'
                        ? { background: 'rgba(52,199,89,0.14)', color: '#1C8A3A' }
                        : { background: 'rgba(10,132,255,0.12)', color: 'var(--accent)' }
                    : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }),
                }}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
      {genError && <p className="px-5 pt-2 text-subheadline text-negative">{genError}</p>}

      {/* Section 3: Allocation */}
      <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
        <DetailSectionHeader label="Allocation" />
        <DetailRow label="FY Allocation Left" value={formatINR(fyRemaining)} accent />
        <DetailRow label="All-Time Allocation Left" value={formatINR(allTimeLeft)} accent />
      </div>

      {/* Section 4: Position (overall) */}
      {fyRow && (fyRow.qty > 0 || fyRow.currentCost > 0) && (
        <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
          <DetailSectionHeader label="Position" />
          <DetailRow label="Shares" value={fyRow.qty > 0 ? String(Math.round(fyRow.qty)) : '—'} />
          <DetailRow label="Avg Cost" value={fyRow.avgCost > 0 ? formatPrice(fyRow.avgCost) : '—'} />
          <DetailRow label="Current Cost" value={fyRow.currentCost > 0 ? formatINR(fyRow.currentCost) : '—'} />
          {fyRow.unrealisedPnL != null && fyRow.unrealisedPnL !== 0 && (
            <DetailRow
              label="Unrealized P&L"
              value={`${fyRow.unrealisedPnL >= 0 ? '+' : ''}${formatINR(fyRow.unrealisedPnL)}`}
            />
          )}
        </div>
      )}

      {/* Section 5: Financials */}
      {financialsRows.length > 0 && (
        <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
          <DetailSectionHeader label="Financials">
            <button onClick={() => { /* TODO: open edit sheet */ }}
              className="flex items-center gap-1 text-body"
              style={{ color: 'var(--accent)' }}>
              <PencilIcon className="w-3.5 h-3.5" />
              Edit
            </button>
          </DetailSectionHeader>
          {financialsRows.map(r => (
            <DetailRow key={r.label} label={r.label} value={r.value} />
          ))}
        </div>
      )}

      {/* View Buy Levels CTA */}
      <div style={{ padding: '20px 20px 0' }}>
        <button
          onClick={() => setShowTranches(true)}
          className="w-full text-headline font-semibold text-white rounded-2xl"
          style={{ background: 'var(--accent)', padding: '16px', border: 'none', cursor: 'pointer' }}>
          View Buy Levels →
        </button>
      </div>

      {/* Sheets */}
      {showKeyPrompt && (
        <KeyPromptSheet
          initialProvider={aiProvider}
          onClose={() => setShowKeyPrompt(false)}
          onSaved={(provider) => { setHasKey(true); setAiProvider(provider) }}
        />
      )}
      {showQMode && (
        <QModeSheet
          currentMode={qMode}
          onSelect={m => {
            if (m === 'bear') toggleQuarters('two_weak_quarters', true)
            else if (m === 'bull') toggleQuarters('two_strong_quarters', true)
            else if (allocation?.two_weak_quarters) toggleQuarters('two_weak_quarters', false)
            else toggleQuarters('two_strong_quarters', false)
            setShowQMode(false)
          }}
          onInfo={() => { setShowQMode(false); setShowQInfo(true) }}
          onClose={() => setShowQMode(false)}
        />
      )}
      {showQInfo && <QuartersInfoSheet onClose={() => setShowQInfo(false)} />}

      {/* Tranche Sheet */}
      {showTranches && (
        <TrancheSheet
          symbol={symbol}
          tranches={tranches}
          remainingAfterTranches={remainingAfterTranches}
          generatingTranches={generatingTranches}
          addingTranche={addingTranche}
          onGenerate={generateTranches}
          onAdd={addTranche}
          onDelete={deleteTranche}
          onClearAll={clearAllTranches}
          onClose={() => setShowTranches(false)}
          setAddingTranche={setAddingTranche}
        />
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function DetailSectionHeader({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5"
      style={{ minHeight: 36, borderBottom: '1px solid var(--border-faint)' }}>
      <span className="text-footnote font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function DetailRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5"
      style={{ minHeight: 46, borderBottom: '1px solid var(--border-faint)' }}>
      <span className="text-body" style={{ color: 'var(--text-2)' }}>{label}</span>
      <span className="text-body tabnum" style={{ color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  )
}

// ── Tranche Sheet ────────────────────────────────────────────────────────────

function TrancheSheet({
  symbol, tranches, remainingAfterTranches,
  generatingTranches, addingTranche,
  onGenerate, onAdd, onDelete, onClearAll, onClose, setAddingTranche,
}: {
  symbol: string
  tranches: BuyTranche[]
  remainingAfterTranches: number
  generatingTranches: boolean
  addingTranche: boolean
  onGenerate: () => void
  onAdd: (qty: number, price: number) => Promise<void>
  onDelete: (id: string) => void
  onClearAll: () => Promise<void>
  onClose: () => void
  setAddingTranche: (v: boolean) => void
}) {
  return (
    <>
      {/* Scrim */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl overflow-hidden"
        style={{ background: 'var(--bg-secondary)', maxHeight: '85dvh', display: 'flex', flexDirection: 'column', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 8px)' }}>

        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 flex-shrink-0 border-b"
          style={{ borderColor: 'var(--border)' }}>
          <span className="text-title-2 font-bold">Buy Levels</span>
          <button onClick={onClose} className="text-body" style={{ color: 'var(--accent)' }}>Done</button>
        </div>

        {/* Meta */}
        <p className="text-subheadline px-5 pt-2.5 pb-1 flex-shrink-0 tabnum" style={{ color: 'var(--text-faint)' }}>
          {symbol} · {formatINR(Math.max(0, remainingAfterTranches))} remaining after tranches
        </p>

        {/* Tranche list */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {tranches.length === 0 && !addingTranche && (
            <p className="px-5 py-4 text-subheadline" style={{ color: 'var(--text-faint)' }}>
              No levels yet — tap Auto-generate
            </p>
          )}
          {tranches.map(t => (
            <TrancheRow key={t.id} tranche={t} onDelete={() => onDelete(t.id)} />
          ))}
          {addingTranche && (
            <AddTrancheRow
              maxAmount={remainingAfterTranches}
              onSave={async (qty, price) => { await onAdd(qty, price); setAddingTranche(false) }}
              onCancel={() => setAddingTranche(false)}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 px-5 pt-3 flex-shrink-0">
          <button onClick={onGenerate} disabled={generatingTranches}
            className="flex-1 flex items-center justify-center gap-1.5 text-body font-semibold rounded-xl disabled:opacity-40"
            style={{ padding: '14px', background: 'rgba(10,132,255,0.10)', color: 'var(--accent)', border: 'none', cursor: 'pointer' }}>
            <SparkleIcon className="w-3.5 h-3.5" />
            {generatingTranches ? 'Generating…' : 'Auto-generate'}
          </button>
          <button onClick={() => setAddingTranche(true)}
            className="flex-1 flex items-center justify-center gap-1.5 text-body font-semibold text-white rounded-xl"
            style={{ padding: '14px', background: 'var(--accent)', border: 'none', cursor: 'pointer' }}>
            <PlusIcon className="w-3.5 h-3.5" />
            Add Manual
          </button>
          <button onClick={onClearAll} disabled={tranches.length === 0}
            className="text-body disabled:opacity-40"
            style={{ color: 'var(--text-negative)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
            Clear All
          </button>
        </div>
      </div>
    </>
  )
}

function TrancheRow({ tranche, onDelete }: { tranche: BuyTranche; onDelete: () => void }) {
  const amount = tranche.qty * tranche.price
  return (
    <div className="flex items-center px-5 border-b" style={{ borderColor: 'var(--border-faint)', minHeight: 56 }}>
      <div className="flex-1">
        <p className="tabnum">
          <span className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatPrice(tranche.price)}
          </span>
          <span className="text-body" style={{ color: 'var(--text-faint)', margin: '0 5px' }}>×</span>
          <span className="text-body" style={{ color: 'var(--text-2)' }}>{Math.round(tranche.qty)}</span>
        </p>
      </div>
      <p className="text-body tabnum flex-shrink-0" style={{ color: 'var(--text-2)' }}>
        {formatINR(amount)}
      </p>
      <button onClick={onDelete}
        className="w-10 h-10 flex items-center justify-center flex-shrink-0 -mr-1"
        style={{ color: 'var(--text-negative)', background: 'none', border: 'none', cursor: 'pointer' }}>
        <TrashIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

function AddTrancheRow({ maxAmount, onSave, onCancel }: {
  maxAmount: number
  onSave: (qty: number, price: number) => Promise<void>
  onCancel: () => void
}) {
  const [qty, setQty]     = useState('')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)

  const amount = (parseFloat(qty) || 0) * (parseFloat(price) || 0)
  const overBudget = amount > 0 && amount > maxAmount

  async function save() {
    const q = parseFloat(qty), p = parseFloat(price)
    if (!q || !p || overBudget) return
    setSaving(true)
    await onSave(q, p)
    setSaving(false)
  }

  return (
    <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
      <div className="flex items-center gap-2 mb-2">
        <input type="text" inputMode="numeric" placeholder="Qty" value={qty}
          onChange={e => setQty(e.target.value)}
          className="tabnum"
          style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 10, fontSize: 15, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none' }} />
        <span style={{ fontSize: 13, color: 'var(--text-faint)', flexShrink: 0 }}>×</span>
        <input type="text" inputMode="decimal" placeholder="Price" value={price}
          onChange={e => setPrice(e.target.value)}
          className="tabnum"
          style={{ flex: 2, minWidth: 0, padding: '10px 12px', borderRadius: 10, fontSize: 15, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none' }} />
      </div>
      {overBudget && (
        <p className="text-subheadline mb-2 tabnum" style={{ color: 'var(--text-negative)' }}>
          Exceeds by {formatINR(amount - maxAmount)}
        </p>
      )}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={save} disabled={saving || !qty || !price || overBudget}
            className="px-4 py-2.5 rounded-xl text-body font-semibold disabled:opacity-40 text-white"
            style={{ background: 'var(--accent)', border: 'none', cursor: 'pointer' }}>
            {saving ? '…' : 'Save'}
          </button>
        </div>
        <button onClick={onCancel}
          className="px-4 py-2.5 rounded-xl text-body font-medium"
          style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Quarter Mode Sheet ───────────────────────────────────────────────────────

function QModeSheet({ currentMode, onSelect, onInfo, onClose }: {
  currentMode: 'bear' | 'normal' | 'bull'
  onSelect: (mode: 'bear' | 'normal' | 'bull') => void
  onInfo: () => void
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 8px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <p className="text-center text-footnote font-semibold uppercase tracking-wider pb-2"
           style={{ color: 'var(--text-faint)', letterSpacing: '0.04em' }}>
          Recent Quarters
        </p>
        {(['Bear', 'Normal', 'Bull'] as const).map(label => {
          const mode = label.toLowerCase() as 'bear' | 'normal' | 'bull'
          const active = currentMode === mode
          return (
            <button key={mode}
              onClick={() => onSelect(mode)}
              className="flex items-center justify-between w-full px-5 border-t"
              style={{ minHeight: 52, borderColor: 'var(--border-faint)' }}>
              <span className="text-headline">{label}</span>
              {active && (
                <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--accent)' }}>
                  <CheckIcon className="w-3 h-3 text-white" />
                </span>
              )}
            </button>
          )
        })}
        <button onClick={onInfo}
          className="flex items-center justify-center w-full border-t"
          style={{ minHeight: 44, borderColor: 'var(--border-faint)', color: 'var(--accent)' }}>
          <span className="text-body">About Recent Quarters…</span>
        </button>
      </div>
    </>
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
          <button onClick={onClose} className="text-accent text-headline w-14 text-right">Done</button>
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
          <button onClick={onClose} className="text-accent text-headline">Cancel</button>
          <p className="font-semibold text-headline">AI API Key</p>
          <button onClick={save} disabled={saving || !key.trim()}
            className="text-accent text-headline font-semibold disabled:opacity-40">
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
