'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { INDEX_CATEGORIES, isBandStale } from '@/lib/band-calculator'
import { formatINRFullNum, formatPriceNum } from '@/lib/formatter'
import type { BuyBand, BuyTranche, StockAllocation, StockCategory, StockRow, Investability, Transaction, DividendTransaction, BuyBandSnapshot } from '@/lib/types'
import { computeSnowball, signalLabel, signalColor } from '@/lib/snowball'
import type { Signal } from '@/lib/snowball'
import BandBar from '@/components/BandBar'
import StockDividends from '@/components/StockDividends'
import { RefreshIcon, SparkleIcon, ChevronRightIcon } from '@/components/icons'
import { revalidateBuyBands } from '@/app/actions'
import UserMenu from '@/components/UserMenu'
import { DetailRow } from '@/components/detail-rows'
import RiskOverlaySheet from './RiskOverlaySheet'
import FinancialsSheet from './FinancialsSheet'
import BandComputationSheet from './BandComputationSheet'
import TranchesSheet from './TranchesSheet'
import InvestabilitySheet from './InvestabilitySheet'
import KeyPromptSheet from './KeyPromptSheet'
import SnowballSheet from './SnowballSheet'


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
  initialInvestability: Investability | null
  symbolTxns: Transaction[]
  initialDividends: DividendTransaction[]
  initialSnapshot: BuyBandSnapshot | null
  initialPriorSnapshot: BuyBandSnapshot | null
}

export default function BandDetailClient({
  symbol, band: initialBand, allocation: initialAllocation,
  fyRow, allTimeQty, allTimeCost,
  tranches: initialTranches,
  fyId, fyLabel, backHref, backLabel, initialHasKey,
  initialInvestability,
  symbolTxns, initialDividends,
  initialSnapshot, initialPriorSnapshot,
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
  const [showKeyPrompt, setShowKeyPrompt]   = useState(false)
  const [showFinancials, setShowFinancials] = useState(false)
  const [showTranches, setShowTranches]     = useState(false)
  const [showComputation, setShowComputation] = useState(false)
  const [showInvestability, setShowInvestability] = useState(false)
  const [investability, setInvestability]   = useState(initialInvestability)
  const [showRiskModal, setShowRiskModal]   = useState(false)
  const [showSnowball, setShowSnowball]     = useState(false)
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

  const riskMultiplier = band?.risk_multiplier ?? null
  const hasOverlay = riskMultiplier != null && riskMultiplier !== 1
  const adjBuyLow    = hasBands && hasOverlay ? buyLow!    * riskMultiplier! : buyLow
  const adjBuyHigh   = hasBands && hasOverlay ? buyHigh!   * riskMultiplier! : buyHigh
  const adjMidLow    = hasBands && hasOverlay ? midLow!    * riskMultiplier! : midLow
  const adjMidHigh   = hasBands && hasOverlay ? midHigh!   * riskMultiplier! : midHigh
  const adjTrimPrice = hasBands && hasOverlay ? trimPrice! * riskMultiplier! : trimPrice
  const staleBands = isBandStale(band?.generated_at, band?.last_updated_at)

  const fyRemaining = fyRow?.remaining ?? 0
  const isIndex = INDEX_CATEGORIES.has(allocation?.category as StockCategory)
  const financialSummary = isIndex ? '2 inputs' : '5 inputs'

  const recentBuys = useMemo(
    () => symbolTxns
      .filter(t => t.trade_type === 'buy')
      .map(t => ({ price: t.price, date: t.trade_date })),
    [symbolTxns]
  )

  const snowball = useMemo(() => {
    if (!cmp || !adjBuyLow || !adjBuyHigh || !adjMidLow || !adjMidHigh || !adjTrimPrice) return null
    if (!initialSnapshot) return null
    return computeSnowball({
      cmp,
      buyLow: adjBuyLow,
      buyHigh: adjBuyHigh,
      midLow: adjMidLow,
      midHigh: adjMidHigh,
      trim: adjTrimPrice,
      g: initialSnapshot.g_computed,
      opMarginNow: initialSnapshot.op_margin,
      gPrior: initialPriorSnapshot?.g_computed ?? null,
      opMarginPrior: initialPriorSnapshot?.op_margin ?? null,
    })
  }, [cmp, adjBuyLow, adjBuyHigh, adjMidLow, adjMidHigh, adjTrimPrice, initialSnapshot, initialPriorSnapshot])

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
        if (action === 'financials') router.refresh()
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
          <div style={{ minWidth: 60 }} className="flex justify-end">
            <UserMenu />
          </div>
        </div>
      </div>

      {/* ── CMP / Regen strip ── */}
      <div className="flex items-center justify-between px-4 gap-2"
        style={{ minHeight: 40, background: 'var(--bg-primary)' }}>
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
        <p className="text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em', marginBottom: 10 }}>
          Buy Band{hasOverlay && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>×{riskMultiplier}</span>}
        </p>
        {hasBands ? (
          <>
            <BandBar
              buyLow={adjBuyLow!} buyHigh={adjBuyHigh!}
              midLow={adjMidLow!} midHigh={adjMidHigh!}
              trimPrice={adjTrimPrice!} cmp={cmp}
            />
            {/* ── 52W Low | CMP | 52W High ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr', alignItems: 'center', padding: '12px 0 14px', marginTop: 8, gap: 8 }}>
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

      {/* ── Risk Overlay row ── */}
      <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
        <button
          onClick={() => setShowRiskModal(true)}
          className="flex items-center justify-between w-full px-4"
          style={{ minHeight: 44 }}>
          <span className="text-body" style={{ color: 'var(--text-2)' }}>Risk Overlay</span>
          <div className="flex items-center gap-2">
            <span className="text-body tabnum" style={{ color: hasOverlay ? 'var(--text-2)' : 'var(--text-faint)' }}>
              {hasOverlay ? String(riskMultiplier) : 'None'}
            </span>
            <span className="text-body text-accent">›</span>
          </div>
        </button>
      </div>

      {/* ── Snowball row ── */}
      {allTimeQty > 0 && (
        <div style={{ background: 'var(--bg-primary)', marginTop: 10 }}>
          <button
            onClick={() => setShowSnowball(true)}
            className="flex items-center justify-between w-full px-4 py-3"
            style={{ minHeight: 56 }}>
            <div style={{ textAlign: 'left' }}>
              <p className="text-body" style={{ color: 'var(--text-2)' }}>Snowball</p>
              {!initialSnapshot && (
                <p className="text-subheadline" style={{ color: 'var(--text-faint)', marginTop: 2 }}>
                  Set up financials to track
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {snowball && snowball.signal !== 'INSUFFICIENT_DATA' ? (
                <span
                  className="tabnum text-subheadline font-semibold"
                  style={{
                    color: signalColor(snowball.signal),
                    background: `color-mix(in srgb, ${signalColor(snowball.signal)} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${signalColor(snowball.signal)} 20%, transparent)`,
                    borderRadius: 999,
                    minHeight: 28,
                    padding: '0 10px',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}>
                  {signalLabel(snowball.signal)}
                </span>
              ) : initialSnapshot && !snowball ? (
                <span className="text-subheadline" style={{ color: 'var(--text-faint)' }}>No bands</span>
              ) : null}
              <ChevronRightIcon className="w-4 h-4" style={{ color: 'var(--text-faint)' }} />
            </div>
          </button>
        </div>
      )}

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
            {investability && (
              <span
                className="tabnum text-subheadline font-semibold"
                style={{
                  color: investability.investable ? 'var(--c-positive)' : 'var(--c-warning)',
                  background: investability.investable
                    ? 'color-mix(in srgb, var(--c-positive) 10%, transparent)'
                    : 'color-mix(in srgb, var(--c-warning) 10%, transparent)',
                  border: `1px solid ${investability.investable
                    ? 'color-mix(in srgb, var(--c-positive) 20%, transparent)'
                    : 'color-mix(in srgb, var(--c-warning) 20%, transparent)'}`,
                  borderRadius: 999,
                  minHeight: 28,
                  padding: '0 10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}>
                {investability.investable ? '✓ ' : ''}{investability.total_score}/50
              </span>
            )}
            <ChevronRightIcon className="w-4 h-4" style={{ color: 'var(--text-faint)' }} />
          </div>
        </button>
      </div>

      {genError && <p className="px-4 pt-2 text-subheadline text-negative">{genError}</p>}

      {/* ── Allocation ── */}
      <div style={{ marginTop: 10, background: 'var(--bg-primary)' }}>
        <p className="text-footnote font-semibold uppercase px-4" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em', paddingTop: 14, paddingBottom: 10 }}>Allocation</p>
        <DetailRow label="Remaining Allocation" value={formatINRFullNum(fyRemaining)} bold />
        <DetailRow label={`Invested ${fyLabel}`} value={formatINRFullNum(fyRow?.spent ?? 0)} />
        <DetailRow label="Invested Total" value={formatINRFullNum(allTimeCost)} />
      </div>

      {/* ── Investment ── */}
      {(allTimeQty > 0 || allTimeCurrentValue != null) && (
        <div style={{ marginTop: 10, background: 'var(--bg-primary)' }}>
          <p className="text-footnote font-semibold uppercase px-4" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em', paddingTop: 14, paddingBottom: 10 }}>Investment</p>
          {allTimeCurrentValue != null && (
            <DetailRow label="Current Value" value={formatINRFullNum(Math.round(allTimeCurrentValue))} />
          )}
          {allTimeQty > 0 && (
            <DetailRow label="Shares Held" value={String(allTimeQty)} noRupee />
          )}
          {allTimeQty > 0 && allTimeCost > 0 && (
            <DetailRow label="Avg Price" value={formatPriceNum(allTimeCost / allTimeQty)} />
          )}
        </div>
      )}

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
            <span className="text-subheadline" style={{ color: staleBands ? 'var(--c-warning)' : 'var(--text-faint)' }}>
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

      {/* ── Dividends ── */}
      <div style={{ marginTop: 10, background: 'var(--bg-primary)' }}>
        <StockDividends
          symbol={symbol}
          exchange={allocation?.exchange ?? symbolTxns[0]?.exchange ?? 'NSE'}
          initialDividends={initialDividends}
          initialTransactions={symbolTxns}
        />
      </div>

      {/* ── Sheets ── */}
      {showKeyPrompt && (
        <KeyPromptSheet
          onClose={() => setShowKeyPrompt(false)}
          onSaved={() => setHasKey(true)}
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
          signal={snowball?.signal ?? null}
          recentBuys={recentBuys}
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
      {showRiskModal && (
        <RiskOverlaySheet
          band={band}
          onClose={() => setShowRiskModal(false)}
          onSaved={b => setBand(b)}
        />
      )}
      {showSnowball && (
        <SnowballSheet
          symbol={symbol}
          snowball={snowball}
          snapshot={initialSnapshot}
          priorSnapshot={initialPriorSnapshot}
          onClose={() => setShowSnowball(false)}
        />
      )}
    </div>
  )
}
