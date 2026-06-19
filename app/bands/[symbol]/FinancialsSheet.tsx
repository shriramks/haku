'use client'
import { useState, useEffect, useRef } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { deriveIndexEps, isBandStale, INDEX_CATEGORIES, computeGrowth, computeHospitalGrowth } from '@/lib/band-calculator'
import type { BuyBand, StockAllocation, StockCategory } from '@/lib/types'
import { SparkleIcon, RefreshIcon } from '@/components/icons'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'
import { saveSnapshotIfChanged } from '@/app/actions'
import { Button } from '@/components/Button'
import { LabeledInput } from '@/components/LabeledInput'

function fiscalQuarterLabel(d: Date): string {
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const fyEnd = month >= 4 ? year + 1 : year
  const quarter = month >= 4 && month <= 6 ? 'Q1'
    : month >= 7 && month <= 9 ? 'Q2'
    : month >= 10 && month <= 12 ? 'Q3'
    : 'Q4'
  return `FY${String(fyEnd).slice(-2)} ${quarter}`
}

export default function FinancialsSheet({ symbol, band, allocation, generating, refreshingFinancials, genError, onGenerateBands, onRecomputeBands, onRefreshFinancials, onBandSaved, onClose }: {
  symbol: string
  band: BuyBand | null
  allocation: StockAllocation | null
  generating: boolean
  refreshingFinancials: boolean
  genError: string
  onGenerateBands: () => void
  onRecomputeBands: () => void
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
  const [opProfitCr, setOpProfitCr] = useState(band?.op_profit_cr?.toString() ?? '')
  const [revenueCr, setRevenueCr]   = useState(band?.revenue_cr?.toString() ?? '')
  const [roce3yrAvg, setRoce3yrAvg] = useState(band?.roce_3yr_avg?.toString() ?? '')
  const [mcap, setMcap]             = useState(band?.mcap?.toString() ?? '')
  const [indexLevel, setIndexLevel] = useState(band?.index_level?.toString() ?? '')
  const [indexPe, setIndexPe]       = useState(band?.index_pe?.toString() ?? '')
  const [cmp, setCmp]               = useState(band?.cmp?.toString() ?? '')
  const kh = useKeyboardHeight()
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
  }, [])

  useEffect(() => {
    setEps(band?.eps?.toString() ?? '')
    setPatNow(band?.pat_now?.toString() ?? '')
    setPat3yrAgo(band?.pat_3yr_ago?.toString() ?? '')
    setOpProfitCr(band?.op_profit_cr?.toString() ?? '')
    setRevenueCr(band?.revenue_cr?.toString() ?? '')
    setRoce3yrAvg(band?.roce_3yr_avg?.toString() ?? '')
    setMcap(band?.mcap?.toString() ?? '')
    setIndexLevel(band?.index_level?.toString() ?? '')
    setIndexPe(band?.index_pe?.toString() ?? '')
    setCmp(band?.cmp?.toString() ?? '')
  }, [band])

  async function save() {
    setSaving(true)
    setSaveFeedback(null)
    try {
      const sb = getSupabaseBrowser()
      const cmpVal        = parseFloat(cmp) || null
      const indexPeVal    = parseFloat(indexPe) || null
      const derivedIndexEps = deriveIndexEps(cmpVal, indexPeVal)
      const patNowVal    = parseFloat(patNow) || null
      const pat3yrAgoVal = parseFloat(pat3yrAgo) || null
      const opProfitVal  = parseFloat(opProfitCr) || null
      const revenueVal   = parseFloat(revenueCr) || null

      const fields: Record<string, unknown> = {
        eps: isIndex ? derivedIndexEps : (parseFloat(eps) || null),
        last_updated_at: new Date().toISOString(),
      }
      if (!isIndex) {
        fields.pat_now      = patNowVal
        fields.pat_3yr_ago  = pat3yrAgoVal
        fields.op_profit_cr = opProfitVal
        fields.revenue_cr   = revenueVal
        fields.roce_3yr_avg = parseFloat(roce3yrAvg) || null
        fields.mcap         = parseFloat(mcap) || null
      } else {
        // Index: persist the edited (CMP, PE) pair + derived eps. Band prices are
        // then recomputed from these stored values via onRecomputeBands (no fetch),
        // so the manual correction holds until the next fresh Regen Bands.
        fields.index_pe = indexPeVal
        fields.cmp      = cmpVal
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

      if (isIndex) {
        // Recompute band prices from the values just saved (refetch:false).
        onBandSaved(savedBand)
        onRecomputeBands()
        setSaveFeedback({ tone: 'positive', message: 'Saved — recomputing bands' })
        if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
        feedbackTimerRef.current = setTimeout(() => setSaveFeedback(null), 1800)
        setSaving(false)
        return
      }

      if (patNowVal != null && pat3yrAgoVal != null) {
        const category = allocation?.category as StockCategory | undefined
        const g = category === 'Hospitals'
          ? computeHospitalGrowth(patNowVal, pat3yrAgoVal, parseFloat(roce3yrAvg) || null).g
          : computeGrowth(patNowVal, pat3yrAgoVal)
        const opMargin = (opProfitVal != null && revenueVal != null && revenueVal !== 0)
          ? opProfitVal / revenueVal
          : null
        await saveSnapshotIfChanged(symbol, {
          pat_now: patNowVal,
          pat_3yr_ago: pat3yrAgoVal,
          op_profit_cr: opProfitVal,
          revenue_cr: revenueVal,
          g_computed: g,
          op_margin: opMargin,
        }, fiscalQuarterLabel(new Date()))
      }

      onBandSaved(savedBand)
      setSaveFeedback({ tone: 'positive', message: 'Financials saved' })
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = setTimeout(() => setSaveFeedback(null), 1800)
    } catch {
      setSaveFeedback({ tone: 'negative', message: 'Failed to save financials' })
    }
    setSaving(false)
  }

  const cmpVal        = parseFloat(cmp) || null
  const indexPeVal    = parseFloat(indexPe) || null
  const derivedIndexEps = deriveIndexEps(cmpVal, indexPeVal)

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
              {!isIndex && (
                <button onClick={onRefreshFinancials} disabled={refreshingFinancials}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl flex-1 text-body font-medium disabled:opacity-40"
                  style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)' }}>
                  <RefreshIcon className={`w-4 h-4 ${refreshingFinancials ? 'animate-spin' : ''}`} />
                  {refreshingFinancials ? 'Refreshing…' : 'Regen Financials'}
                </button>
              )}
            </div>
            {genError && <p className="text-subheadline text-negative mb-3">{genError}</p>}
            {staleBands && (
              <p className="text-subheadline mb-3" style={{ color: 'var(--c-warning)' }}>
                Financials changed. Regen Bands to apply.
              </p>
            )}
            <p className="text-subheadline mb-3" style={{ color: 'var(--text-faint)' }}>
              {allocation?.category ? `${allocation.category} · ` : ''}PE
            </p>
            <div className="flex flex-col gap-3 mb-4">
              {!isIndex ? (
                <>
                  <LabeledInput label="EPS (₹)" value={eps} onChange={setEps} placeholder="e.g. 18" />
                  <LabeledInput label="PAT Now (Cr)" value={patNow} onChange={setPatNow} placeholder="e.g. 5200" />
                  <LabeledInput label="PAT 3yr Ago (Cr)" value={pat3yrAgo} onChange={setPat3yrAgo} placeholder="e.g. 3800" />
                  <LabeledInput label="Op Profit (Cr)" value={opProfitCr} onChange={setOpProfitCr} placeholder="e.g. 1200" />
                  <LabeledInput label="Revenue (Cr)" value={revenueCr} onChange={setRevenueCr} placeholder="e.g. 8500" />
                  <LabeledInput label="ROCE 3yr Avg (%)" value={roce3yrAvg} onChange={setRoce3yrAvg} placeholder="e.g. 36.8" />
                  <LabeledInput label="Mcap (Cr)" value={mcap} onChange={setMcap} placeholder="e.g. 18737" />
                </>
              ) : (
                <>
                  <LabeledInput label="Index PE" value={indexPe} onChange={setIndexPe} placeholder="e.g. 22" />
                  <LabeledInput label="CMP" value={cmp} onChange={setCmp} placeholder="e.g. 273" />
                  <LabeledInput
                    label="Index Level"
                    readOnly
                    value={indexLevel || '—'}
                  />
                  <LabeledInput
                    label="EPS per unit (CMP ÷ PE)"
                    readOnly
                    value={derivedIndexEps != null ? derivedIndexEps.toFixed(2) : '—'}
                  />
                </>
              )}
            </div>
            <Button onClick={save} loading={saving} fullWidth className="mt-1">
              Save
            </Button>
            {saveFeedback && (
              <p className={`text-subheadline mt-3 text-center ${saveFeedback.tone === 'positive' ? 'text-positive' : 'text-negative'}`}>
                {saveFeedback.message}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
