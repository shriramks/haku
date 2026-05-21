'use client'
import { useState, useMemo } from 'react'
import type { FiscalYear, Transaction, DividendTransaction } from '@/lib/types'
import type { MFund, MFTransaction, SGBTransaction } from '@/lib/portfolio-types'
import { computeStockGains, computeMFGains, computeGoldGains } from '@/lib/tax-compute'
import FYPicker from '@/components/FYPicker'
import { Num } from '@/components/Num'
import { ChevronDownIcon } from '@/components/icons'

interface Props {
  fiscalYears:  FiscalYear[]
  currentFY:    FiscalYear | null
  stockTxns:    Transaction[]
  mfFunds:      MFund[]
  mfTxns:       MFTransaction[]
  sgbTxns:      SGBTransaction[]
  dividends:    DividendTransaction[]
}

const LTCG_EXEMPTION = 125_000  // 1.25 L — Budget 2024

type SectionKey = 'summary' | 'details' | 'harvesting' | 'export'

export default function TaxClient({
  fiscalYears,
  currentFY,
  stockTxns,
  mfFunds,
  mfTxns,
  sgbTxns,
  dividends,
}: Props) {
  const [selectedFY, setSelectedFY]     = useState<FiscalYear | null>(currentFY)
  const [expanded, setExpanded]         = useState<Set<SectionKey>>(new Set(['summary']))

  const fyRange = useMemo(() => {
    if (!selectedFY) return null
    return { start: selectedFY.start_date, end: selectedFY.end_date }
  }, [selectedFY])

  const { totalLTCG, totalSTCG, dividendIncome } = useMemo(() => {
    if (!fyRange) return { totalLTCG: 0, totalSTCG: 0, dividendIncome: 0 }

    const asOf = new Date().toISOString().slice(0, 10)
    let ltcg = 0
    let stcg = 0

    // Stocks — group by symbol
    const stockMap = new Map<string, Transaction[]>()
    for (const txn of stockTxns) {
      const arr = stockMap.get(txn.symbol) ?? []
      arr.push(txn)
      stockMap.set(txn.symbol, arr)
    }
    for (const [symbol, txns] of stockMap) {
      const { realised } = computeStockGains(txns, symbol, null, fyRange, asOf)
      for (const g of realised) {
        if (g.gainType === 'LTCG') ltcg += g.gain
        else stcg += g.gain
      }
    }

    // MF — group by fund_id
    const mfMap = new Map<string, MFTransaction[]>()
    for (const txn of mfTxns) {
      const arr = mfMap.get(txn.fund_id) ?? []
      arr.push(txn)
      mfMap.set(txn.fund_id, arr)
    }
    for (const [fundId, txns] of mfMap) {
      const fund = mfFunds.find(f => f.id === fundId)
      void fund  // name not needed for gains computation
      const { realised } = computeMFGains(txns, fundId, null, null, fyRange, asOf)
      for (const g of realised) {
        if (g.gainType === 'LTCG') ltcg += g.gain
        else stcg += g.gain
      }
    }

    // Gold (SGB) — treat as one pool per gold_type
    const goldMap = new Map<string, SGBTransaction[]>()
    for (const txn of sgbTxns) {
      const arr = goldMap.get(txn.gold_type) ?? []
      arr.push(txn)
      goldMap.set(txn.gold_type, arr)
    }
    for (const [goldType, txns] of goldMap) {
      const { realised } = computeGoldGains(txns, goldType, null, fyRange, asOf)
      for (const g of realised) {
        if (g.gainType === 'LTCG') ltcg += g.gain
        else stcg += g.gain
      }
    }

    // Dividend income within selected FY
    const divIncome = dividends
      .filter(d => d.ex_date >= fyRange.start && d.ex_date <= fyRange.end)
      .reduce((s, d) => s + d.amount, 0)

    return { totalLTCG: ltcg, totalSTCG: stcg, dividendIncome: divIncome }
  }, [fyRange, stockTxns, mfTxns, mfFunds, sgbTxns, dividends])

  const totalGain    = totalLTCG + totalSTCG
  const taxableLTCG  = Math.max(0, totalLTCG - LTCG_EXEMPTION)
  const ltcgTax      = taxableLTCG * 0.125
  const stcgTax      = Math.max(0, totalSTCG) * 0.20

  function toggle(key: SectionKey) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="pb-24" style={{ background: 'var(--bg-primary)', minHeight: '100dvh' }}>

      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
           style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-faint)' }}>
        <h1 className="text-title-3 font-bold" style={{ color: 'var(--text-primary)' }}>Tax Report</h1>
        <FYPicker fiscalYears={fiscalYears} selectedFY={selectedFY} onSelect={setSelectedFY} />
      </div>

      {/* Hero strip */}
      <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1px 1fr 1px 1fr', alignItems: 'start' }}>

          <div className="flex flex-col gap-0.5">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Total Gains</p>
            <p className="text-title-2 font-bold tabnum" style={{ marginTop: 2, color: 'var(--text-primary)' }}>
              <Num amount={totalGain} signed />
            </p>
          </div>

          <div style={{ width: 1, height: 44, background: 'var(--border-faint)' }} />

          <div className="flex flex-col gap-0.5 items-center">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>LTCG</p>
            <p className="text-title-2 font-bold tabnum" style={{ marginTop: 2, color: 'var(--text-primary)' }}>
              <Num amount={totalLTCG} signed />
            </p>
          </div>

          <div style={{ width: 1, height: 44, background: 'var(--border-faint)' }} />

          <div className="flex flex-col gap-0.5 items-end">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>STCG</p>
            <p className="text-title-2 font-bold tabnum" style={{ marginTop: 2, color: 'var(--text-primary)' }}>
              <Num amount={totalSTCG} signed />
            </p>
          </div>

        </div>
      </div>

      {/* Sections */}
      <div className="mt-2">
        <Section title="Summary"    sectionKey="summary"    expanded={expanded} onToggle={toggle}>
          <SummaryBody
            totalLTCG={totalLTCG}
            taxableLTCG={taxableLTCG}
            ltcgTax={ltcgTax}
            totalSTCG={totalSTCG}
            stcgTax={stcgTax}
            dividendIncome={dividendIncome}
          />
        </Section>

        <Section title="Details"    sectionKey="details"    expanded={expanded} onToggle={toggle}>
          <div className="px-4 py-3">
            <p className="text-body" style={{ color: 'var(--text-muted)' }}>Coming soon</p>
          </div>
        </Section>

        <Section title="Harvesting" sectionKey="harvesting" expanded={expanded} onToggle={toggle}>
          <div className="px-4 py-3">
            <p className="text-body" style={{ color: 'var(--text-muted)' }}>Coming soon</p>
          </div>
        </Section>

        <Section title="Export"     sectionKey="export"     expanded={expanded} onToggle={toggle}>
          <div className="px-4 py-3">
            <p className="text-body" style={{ color: 'var(--text-muted)' }}>Coming soon</p>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({
  title,
  sectionKey,
  expanded,
  onToggle,
  children,
}: {
  title:      string
  sectionKey: SectionKey
  expanded:   Set<SectionKey>
  onToggle:   (k: SectionKey) => void
  children:   React.ReactNode
}) {
  const isOpen = expanded.has(sectionKey)
  return (
    <div className="border-b" style={{ borderColor: 'var(--border-faint)' }}>
      <button
        onClick={() => onToggle(sectionKey)}
        className="flex items-center justify-between w-full px-4 tap-row"
        style={{ minHeight: 48 }}>
        <span className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <ChevronDownIcon
          className="w-4 h-4 transition-transform"
          style={{
            color: 'var(--text-faint)',
            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        />
      </button>
      {isOpen && children}
    </div>
  )
}

// ── Summary section body ───────────────────────────────────────────────────────

function SummaryBody({
  totalLTCG,
  taxableLTCG,
  ltcgTax,
  totalSTCG,
  stcgTax,
  dividendIncome,
}: {
  totalLTCG:     number
  taxableLTCG:   number
  ltcgTax:       number
  totalSTCG:     number
  stcgTax:       number
  dividendIncome: number
}) {
  return (
    <div className="pb-2">

      {/* LTCG group */}
      <GroupLabel label="LTCG" />
      <TaxRow label="Gains">
        <Num amount={totalLTCG} signed />
      </TaxRow>
      <TaxRow label="Exemption" muted>
        <span>1.25<span className="num-u"> L</span></span>
      </TaxRow>
      <TaxRow label="Taxable Gains">
        <Num amount={taxableLTCG} signed />
      </TaxRow>
      <TaxRow label="Tax @ 12.5%">
        <Num amount={ltcgTax} />
      </TaxRow>

      {/* STCG group */}
      <GroupLabel label="STCG" />
      <TaxRow label="Gains">
        <Num amount={totalSTCG} signed />
      </TaxRow>
      <TaxRow label="Tax @ 20%">
        <Num amount={stcgTax} />
      </TaxRow>

      {/* Dividend Income group */}
      <GroupLabel label="Dividend Income" />
      <TaxRow label="Received">
        <Num amount={dividendIncome} signed />
      </TaxRow>

    </div>
  )
}

function GroupLabel({ label }: { label: string }) {
  return (
    <p className="text-footnote font-semibold uppercase px-4 pt-4 pb-1"
       style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>
      {label}
    </p>
  )
}

function TaxRow({ label, muted, children }: { label: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4" style={{ minHeight: 44 }}>
      <span className="text-body" style={{ color: 'var(--text-2)' }}>{label}</span>
      <span className="tabnum text-body" style={{
        color: 'var(--text-primary)',
        fontWeight: muted ? 400 : 400,
        opacity: muted ? 0.5 : 1,
      }}>
        {children}
      </span>
    </div>
  )
}
