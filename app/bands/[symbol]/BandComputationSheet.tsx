'use client'
import { useState, useEffect } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import {
  DEFAULT_ERP,
  calculateBands,
  computeGrowth,
  getCostOfEquity,
  getRoceThreshold,
  getSizeMod,
  getSizeModValueLabel,
  isBandStale,
  INDEX_CATEGORIES,
} from '@/lib/band-calculator'
import type { BuyBand, StockAllocation, StockCategory } from '@/lib/types'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import { CompRow, SectionLabel } from '@/components/detail-rows'

export default function BandComputationSheet({ band, allocation, onClose }: {
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
    <BottomSheet onClose={onClose} className="overflow-y-auto max-h-[85vh]">
      <SheetHeader
        title="Band Computation"
        left={null}
        right={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Done</button>}
      />
        <div className="px-5 pt-4">
          {staleBands && (
            <p className="text-subheadline mb-3" style={{ color: 'var(--c-warning)' }}>
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
    </BottomSheet>
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
    <BottomSheet onClose={onClose} zIndex={60}>
      <SheetHeader
        title="Market Cap Rule"
        left={null}
        right={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Done</button>}
      />
      <div className="px-5 pt-2">
        {brackets.map((b) => {
          const active = b.value === applied
          return (
            <div key={b.value} className="flex items-center justify-between" style={{ minHeight: 44 }}>
              <span className="text-body" style={{ color: active ? 'var(--text-primary)' : 'var(--text-faint)' }}>{b.label}</span>
              <span className="text-body tabnum" style={{ color: active ? 'var(--accent)' : 'var(--text-faint)', fontWeight: active ? 600 : 400 }}>{b.value.toFixed(2)}</span>
            </div>
          )
        })}
      </div>
    </BottomSheet>
  )
}

function MarketCapRuleRow({ mcap }: { mcap: number | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="flex items-center justify-between w-full" onClick={() => setOpen(true)}
              style={{ minHeight: 32, borderTop: 'none' }}>
        <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>Market Cap Rule</span>
        <span className="tabnum" style={{ fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 2 }}>
          {getSizeModValueLabel(mcap)}
          <span style={{ fontSize: 13 }}>›</span>
        </span>
      </button>
      {open && <MarketCapRuleModal mcap={mcap} onClose={() => setOpen(false)} />}
    </>
  )
}
