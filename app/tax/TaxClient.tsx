'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import type { FiscalYear, Transaction, DividendTransaction } from '@/lib/types'
import type { MFund, MFTransaction, SGBTransaction } from '@/lib/portfolio-types'
import { computeStockGains, computeMFGains, computeGoldGains, mfAssetClass, groupBy } from '@/lib/tax-compute'
import type { RealisedGain, GainType, AssetType, UnrealisedPosition } from '@/lib/tax-compute'
import { formatDate } from '@/lib/formatter'
import FYPicker from '@/components/FYPicker'
import BottomSheet from '@/components/BottomSheet'
import { Num } from '@/components/Num'
import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons'
import { DetailRow, SectionLabel } from '@/components/detail-rows'
import UserMenu from '@/components/UserMenu'

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

interface NearThresholdRow {
  position:   UnrealisedPosition
  daysToLTCG: number
  name:       string
}

interface SellRow {
  assetType: AssetType
  symbol:    string
  name:      string  // display name (fund name for MF; same as symbol for stocks/gold)
  sellDate:  string
  lots:      RealisedGain[]
  totalGain: number
  gainType:  GainType | 'mixed'
  minDays:   number
  maxDays:   number
}

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
  const [cmps, setCmps]                 = useState<Record<string, number>>({})
  const [navs, setNavs]                 = useState<Record<string, number>>({})  // keyed by scheme_code
  const [goldPrice, setGoldPrice]       = useState<number | null>(null)
  const [pricesLoading, setPricesLoading] = useState(false)
  const pricesFetchedRef                = useRef(false)

  const fyRange = useMemo(() => {
    if (!selectedFY) return null
    return { start: selectedFY.start_date, end: selectedFY.end_date }
  }, [selectedFY])

  const stockMap = useMemo(() => groupBy(stockTxns, t => t.symbol),    [stockTxns])
  const mfMap    = useMemo(() => groupBy(mfTxns,    t => t.fund_id),   [mfTxns])
  const goldMap  = useMemo(() => groupBy(sgbTxns,   t => t.gold_type), [sgbTxns])

  // Fetch live prices when harvesting section is opened (once per page load)
  useEffect(() => {
    if (!expanded.has('harvesting') || pricesFetchedRef.current) return
    pricesFetchedRef.current = true
    setPricesLoading(true)

    const fetches: Promise<void>[] = []

    const stockSymbols = [...new Set(stockTxns.map(t => t.symbol))]
    if (stockSymbols.length > 0) {
      fetches.push(
        fetch(`/api/cmp/batch?symbols=${encodeURIComponent(stockSymbols.join(','))}`)
          .then(r => r.json())
          .then(d => { if (d.prices) setCmps(d.prices) })
          .catch(() => {})
      )
    }

    for (const fund of mfFunds) {
      fetches.push(
        fetch(`https://api.mfapi.in/mf/${fund.scheme_code}`)
          .then(r => r.json())
          .then(d => {
            const nav = parseFloat(d.data?.[0]?.nav)
            if (!isNaN(nav)) setNavs(prev => ({ ...prev, [fund.scheme_code]: nav }))
          })
          .catch(() => {})
      )
    }

    if (sgbTxns.length > 0) {
      fetches.push(
        fetch('/api/gold-price')
          .then(r => r.json())
          .then(d => { if (d.pricePerGram) setGoldPrice(d.pricePerGram) })
          .catch(() => {})
      )
    }

    Promise.allSettled(fetches).then(() => setPricesLoading(false))
  }, [expanded, stockTxns, mfFunds, sgbTxns])

  const computed = useMemo(() => {
    const empty = {
      gains: { equityLTCG: 0, equitySTCG: 0, debtLTCG: 0, debtSTCG: 0, goldLTCG: 0, goldSTCG: 0, dividendIncome: 0 },
      detailRows: [] as SellRow[],
      unrealisedPositions: [] as UnrealisedPosition[],
    }
    if (!fyRange) return empty

    const asOf = new Date().toISOString().slice(0, 10)
    let eqLTCG = 0, eqSTCG = 0, dtLTCG = 0, dtSTCG = 0, gdLTCG = 0, gdSTCG = 0
    const rows: SellRow[] = []
    const unrealisedPositions: UnrealisedPosition[] = []

    function addSellRows(gained: RealisedGain[], assetType: AssetType, symbol: string, name: string) {
      for (const [sellDate, lots] of groupBy(gained, g => g.sellDate)) {
        const totalGain = lots.reduce((s, g) => s + g.gain, 0)
        const hasLTCG   = lots.some(g => g.gainType === 'LTCG')
        const hasSTCG   = lots.some(g => g.gainType === 'STCG')
        const gainType: GainType | 'mixed' = hasLTCG && hasSTCG ? 'mixed' : hasLTCG ? 'LTCG' : 'STCG'
        const days      = lots.map(g => g.holdingDays)
        rows.push({ assetType, symbol, name, sellDate, lots, totalGain, gainType, minDays: Math.min(...days), maxDays: Math.max(...days) })
      }
    }

    for (const [symbol, txns] of stockMap) {
      const { realised, unrealised } = computeStockGains(txns, symbol, null, fyRange, asOf)
      for (const g of realised) { if (g.gainType === 'LTCG') eqLTCG += g.gain; else eqSTCG += g.gain }
      addSellRows(realised, 'stock', symbol, symbol)
      unrealisedPositions.push(...unrealised)
    }

    for (const [fundId, txns] of mfMap) {
      const fund = mfFunds.find(f => f.id === fundId)
      const cls  = fund ? mfAssetClass(fund) : 'equity'
      const { realised, unrealised } = computeMFGains(txns, fundId, null, null, fyRange, asOf)
      for (const g of realised) {
        if (cls === 'debt') { if (g.gainType === 'LTCG') dtLTCG += g.gain; else dtSTCG += g.gain }
        else                { if (g.gainType === 'LTCG') eqLTCG += g.gain; else eqSTCG += g.gain }
      }
      addSellRows(realised, 'mf', fundId, fund?.scheme_name ?? fundId)
      unrealisedPositions.push(...unrealised)
    }

    for (const [goldType, txns] of goldMap) {
      const { realised, unrealised } = computeGoldGains(txns, goldType, null, fyRange, asOf)
      for (const g of realised) { if (g.gainType === 'LTCG') gdLTCG += g.gain; else gdSTCG += g.gain }
      addSellRows(realised, 'gold', goldType, goldType)
      unrealisedPositions.push(...unrealised)
    }

    const divIncome = dividends
      .filter(d => d.ex_date >= fyRange.start && d.ex_date <= fyRange.end)
      .reduce((s, d) => s + d.amount, 0)

    const order: Record<AssetType, number> = { stock: 0, mf: 1, gold: 2 }
    rows.sort((a, b) => {
      if (a.assetType !== b.assetType) return order[a.assetType] - order[b.assetType]
      return b.sellDate.localeCompare(a.sellDate)
    })

    return {
      gains: { equityLTCG: eqLTCG, equitySTCG: eqSTCG, debtLTCG: dtLTCG, debtSTCG: dtSTCG, goldLTCG: gdLTCG, goldSTCG: gdSTCG, dividendIncome: divIncome },
      detailRows: rows,
      unrealisedPositions,
    }
  }, [fyRange, stockMap, mfMap, goldMap, mfFunds, dividends])

  const harvestingData = useMemo(() => {
    const { unrealisedPositions } = computed
    if (unrealisedPositions.length === 0) return { unrealisedLoss: null, nearThreshold: [] as NearThresholdRow[] }

    const withPrices = unrealisedPositions.map(p => {
      let price: number | null = null
      if      (p.assetType === 'stock') { price = cmps[p.symbol] ?? null }
      else if (p.assetType === 'mf')    { const fund = mfFunds.find(f => f.id === p.symbol); price = fund ? (navs[fund.scheme_code] ?? null) : null }
      else if (p.assetType === 'gold')  { price = goldPrice }
      const currentValue = price !== null ? p.qty * price : null
      const gain         = currentValue !== null ? currentValue - p.purchaseCost : null
      return { ...p, currentValue, gain }
    })

    const equityPositions = withPrices.filter(p => {
      if (p.assetType === 'stock') return true
      if (p.assetType === 'mf') {
        const fund = mfFunds.find(f => f.id === p.symbol)
        return !fund || mfAssetClass(fund) === 'equity'
      }
      return false
    })

    const pricesAvailable = Object.keys(cmps).length > 0 || Object.keys(navs).length > 0 || goldPrice !== null
    const unrealisedLoss = pricesAvailable
      ? equityPositions.filter(p => p.gain !== null && p.gain < 0).reduce((s, p) => s + (p.gain ?? 0), 0)
      : null

    const nearThreshold: NearThresholdRow[] = equityPositions
      .filter(p => p.gainType === 'STCG' && p.holdingDays >= 335)
      .map(p => {
        const daysToLTCG = 365 - p.holdingDays
        const fund = p.assetType === 'mf' ? mfFunds.find(f => f.id === p.symbol) : null
        return { position: p, daysToLTCG, name: fund ? fund.scheme_name : p.symbol }
      })
      .sort((a, b) => a.daysToLTCG - b.daysToLTCG)

    return { unrealisedLoss, nearThreshold }
  }, [computed, mfFunds, cmps, navs, goldPrice])

  const { gains: { equityLTCG, equitySTCG, debtLTCG, debtSTCG, goldLTCG, goldSTCG, dividendIncome }, detailRows } = computed

  const equityTotal  = equityLTCG + equitySTCG
  const debtTotal    = debtLTCG + debtSTCG
  const taxableLTCG  = Math.max(0, equityLTCG - LTCG_EXEMPTION)
  const ltcgTax      = taxableLTCG * 0.125
  const stcgTax      = Math.max(0, equitySTCG) * 0.20

  function toggle(key: SectionKey) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div style={{ background: 'var(--bg-primary)', minHeight: '100dvh', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl border-b px-4 pb-3"
           style={{ background: 'var(--bg-nav)', borderColor: 'var(--border-faint)', paddingTop: 'max(env(safe-area-inset-top,0px), 16px)' }}>
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-display font-bold">Tax Report</h1>
          <div className="flex items-center gap-2">
            <FYPicker fiscalYears={fiscalYears} selectedFY={selectedFY} onSelect={setSelectedFY} />
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Hero strip */}
      <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>

        {/* Equity row */}
        <div className="grid mb-3" style={{ gridTemplateColumns: '1fr 1px 1fr 1px 1fr', alignItems: 'start' }}>
          <div className="flex flex-col gap-0.5">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Equity</p>
            <p className="text-title-1 font-bold tabnum" style={{ marginTop: 2, color: 'var(--text-primary)' }}>
              <Num amount={equityTotal} signed />
            </p>
          </div>
          <div style={{ width: 1, height: 44, background: 'var(--border-faint)' }} />
          <div className="flex flex-col gap-0.5 items-center">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Equity LTCG</p>
            <p className="text-title-1 font-bold tabnum" style={{ marginTop: 2, color: 'var(--text-primary)' }}>
              <Num amount={equityLTCG} signed />
            </p>
          </div>
          <div style={{ width: 1, height: 44, background: 'var(--border-faint)' }} />
          <div className="flex flex-col gap-0.5 items-end">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Equity STCG</p>
            <p className="text-title-1 font-bold tabnum" style={{ marginTop: 2, color: 'var(--text-primary)' }}>
              <Num amount={equitySTCG} signed />
            </p>
          </div>
        </div>

        {/* Debt row */}
        <div className="grid" style={{ gridTemplateColumns: '1fr 1px 1fr 1px 1fr', alignItems: 'start' }}>
          <div className="flex flex-col gap-0.5">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Debt</p>
            <p className="text-title-1 font-bold tabnum" style={{ marginTop: 2, color: 'var(--text-primary)' }}>
              <Num amount={debtTotal} signed />
            </p>
          </div>
          <div style={{ width: 1, height: 44, background: 'var(--border-faint)' }} />
          <div className="flex flex-col gap-0.5 items-center">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Debt LTCG</p>
            <p className="text-title-1 font-bold tabnum" style={{ marginTop: 2, color: 'var(--text-primary)' }}>
              <Num amount={debtLTCG} signed />
            </p>
          </div>
          <div style={{ width: 1, height: 44, background: 'var(--border-faint)' }} />
          <div className="flex flex-col gap-0.5 items-end">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Debt STCG</p>
            <p className="text-title-1 font-bold tabnum" style={{ marginTop: 2, color: 'var(--text-primary)' }}>
              <Num amount={debtSTCG} signed />
            </p>
          </div>
        </div>

      </div>

      {/* Sections */}
      <div className="mt-2">
        <Section title="Summary"    sectionKey="summary"    expanded={expanded} onToggle={toggle}>
          <SummaryBody
            equityLTCG={equityLTCG}
            taxableLTCG={taxableLTCG}
            ltcgTax={ltcgTax}
            equitySTCG={equitySTCG}
            stcgTax={stcgTax}
            debtLTCG={debtLTCG}
            debtSTCG={debtSTCG}
            goldLTCG={goldLTCG}
            goldSTCG={goldSTCG}
            dividendIncome={dividendIncome}
          />
        </Section>

        <Section title="Details"    sectionKey="details"    expanded={expanded} onToggle={toggle}>
          <DetailsBody rows={detailRows} />
        </Section>

        <Section title="Harvesting" sectionKey="harvesting" expanded={expanded} onToggle={toggle}>
          <HarvestingBody
            equityLTCG={equityLTCG}
            equitySTCG={equitySTCG}
            unrealisedLoss={harvestingData.unrealisedLoss}
            nearThreshold={harvestingData.nearThreshold}
            pricesLoading={pricesLoading}
          />
        </Section>

        <Section title="Export"     sectionKey="export"     expanded={expanded} onToggle={toggle}>
          <ExportBody detailRows={detailRows} selectedFY={selectedFY} />
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
  equityLTCG,
  taxableLTCG,
  ltcgTax,
  equitySTCG,
  stcgTax,
  debtLTCG,
  debtSTCG,
  goldLTCG,
  goldSTCG,
  dividendIncome,
}: {
  equityLTCG:    number
  taxableLTCG:   number
  ltcgTax:       number
  equitySTCG:    number
  stcgTax:       number
  debtLTCG:      number
  debtSTCG:      number
  goldLTCG:      number
  goldSTCG:      number
  dividendIncome: number
}) {
  const hasDebt = debtLTCG !== 0 || debtSTCG !== 0
  const hasGold = goldLTCG !== 0 || goldSTCG !== 0

  return (
    <div className="pb-2">

      {/* Equity LTCG */}
      <SectionLabel label="Equity LTCG" className="px-4" />
      <DetailRow label="Gains" bold noRupee><Num amount={equityLTCG} signed /></DetailRow>
      <DetailRow label="Exemption" muted noRupee><span>1.25<span className="num-u"> L</span></span></DetailRow>
      <DetailRow label="Taxable Gains" bold noRupee><Num amount={taxableLTCG} signed /></DetailRow>
      <DetailRow label="Tax @ 12.5%" bold noRupee><Num amount={ltcgTax} /></DetailRow>

      {/* Equity STCG */}
      <SectionLabel label="Equity STCG" className="px-4" />
      <DetailRow label="Gains" bold noRupee><Num amount={equitySTCG} signed /></DetailRow>
      <DetailRow label="Tax @ 20%" bold noRupee><Num amount={stcgTax} /></DetailRow>

      {/* Debt — only shown when non-zero */}
      {hasDebt && (
        <>
          <SectionLabel label="Debt" className="px-4" />
          <DetailRow label="LTCG" bold noRupee><Num amount={debtLTCG} signed /></DetailRow>
          <DetailRow label="STCG" bold noRupee><Num amount={debtSTCG} signed /></DetailRow>
          <div className="px-4 pb-2">
            <p className="text-footnote" style={{ color: 'var(--text-faint)' }}>Debt gains taxed at slab rate — verify with your CA</p>
          </div>
        </>
      )}

      {/* Gold — only shown when non-zero */}
      {hasGold && (
        <>
          <SectionLabel label="Gold" className="px-4" />
          <DetailRow label="LTCG" bold noRupee><Num amount={goldLTCG} signed /></DetailRow>
          <DetailRow label="STCG" bold noRupee><Num amount={goldSTCG} signed /></DetailRow>
        </>
      )}

      {/* Dividend Income */}
      <SectionLabel label="Dividend Income" className="px-4" />
      <DetailRow label="Received" bold noRupee><Num amount={dividendIncome} signed /></DetailRow>

    </div>
  )
}

// ── Details section body ───────────────────────────────────────────────────────

function DetailsBody({ rows }: { rows: SellRow[] }) {
  const [selected, setSelected] = useState<SellRow | null>(null)

  if (rows.length === 0) {
    return (
      <div className="px-4 py-3">
        <p className="text-body" style={{ color: 'var(--text-muted)' }}>No realised gains this FY</p>
      </div>
    )
  }

  const stockRows = rows.filter(r => r.assetType === 'stock')
  const mfRows    = rows.filter(r => r.assetType === 'mf')
  const goldRows  = rows.filter(r => r.assetType === 'gold')

  return (
    <div className="pb-2">
      {stockRows.length > 0 && (
        <>
          <SectionLabel label="Stocks" className="px-4" />
          {stockRows.map(row => (
            <GainRow key={`${row.symbol}-${row.sellDate}`} row={row} onTap={() => setSelected(row)} />
          ))}
        </>
      )}
      {mfRows.length > 0 && (
        <>
          <SectionLabel label="Mutual Funds" className="px-4" />
          {mfRows.map(row => (
            <GainRow key={`${row.symbol}-${row.sellDate}`} row={row} onTap={() => setSelected(row)} />
          ))}
        </>
      )}
      {goldRows.length > 0 && (
        <>
          <SectionLabel label="Gold" className="px-4" />
          {goldRows.map(row => (
            <GainRow key={`${row.symbol}-${row.sellDate}`} row={row} onTap={() => setSelected(row)} />
          ))}
        </>
      )}
      {selected && <LotDetailSheet row={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function GainBadge({ gainType }: { gainType: GainType | 'mixed' }) {
  const isLTCG = gainType === 'LTCG'
  const isSTCG = gainType === 'STCG'
  const color  = isLTCG ? 'var(--c-positive)' : isSTCG ? 'var(--c-warning)' : 'var(--text-muted)'
  const bg     = isLTCG
    ? 'color-mix(in srgb, var(--c-positive) 12%, transparent)'
    : isSTCG
      ? 'color-mix(in srgb, var(--c-warning) 12%, transparent)'
      : 'var(--bg-tertiary)'
  const label  = isLTCG ? 'LTCG' : isSTCG ? 'STCG' : 'Mixed'
  return (
    <span
      className="text-footnote font-semibold"
      style={{ color, background: bg, padding: '1px 5px', borderRadius: 4, letterSpacing: '0.03em', flexShrink: 0 }}>
      {label}
    </span>
  )
}

function GainRow({ row, onTap }: { row: SellRow; onTap: () => void }) {
  const daysLabel = row.minDays === row.maxDays
    ? `held ${row.minDays} days`
    : `held ${row.minDays}–${row.maxDays} days`

  return (
    <button
      onClick={onTap}
      className="flex items-center justify-between w-full px-4 tap-row"
      style={{ minHeight: 52 }}>
      <div className="flex flex-col gap-0.5 items-start min-w-0">
        <span className="text-body font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {row.name}
        </span>
        <div className="flex items-center gap-1.5">
          <GainBadge gainType={row.gainType} />
          <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>
            Sold {formatDate(row.sellDate)} · {daysLabel}
          </span>
        </div>
      </div>
      <span className="tabnum text-body ml-3 flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
        <Num amount={row.totalGain} signed />
      </span>
    </button>
  )
}

function LotDetailSheet({ row, onClose }: { row: SellRow; onClose: () => void }) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="px-4 pt-1 pb-3">
        <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>{row.name}</p>
        <p className="text-footnote mt-0.5" style={{ color: 'var(--text-muted)' }}>Sold {formatDate(row.sellDate)}</p>
      </div>
      <div style={{ height: 1, background: 'var(--border-faint)' }} />
      {row.lots.map((lot, i) => <LotRow key={i} lot={lot} />)}
    </BottomSheet>
  )
}

function LotRow({ lot }: { lot: RealisedGain }) {
  const qtyStr = Number.isInteger(lot.qty) ? String(lot.qty) : lot.qty.toFixed(3).replace(/\.?0+$/, '')
  return (
    <div className="flex items-center justify-between px-4" style={{ minHeight: 52 }}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-body" style={{ color: 'var(--text-primary)' }}>
            Bought {formatDate(lot.purchaseDate)}
          </span>
          <GainBadge gainType={lot.gainType} />
        </div>
        <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>
          {qtyStr} units · <Num amount={lot.purchaseCost} /> → <Num amount={lot.saleValue} /> · {lot.holdingDays} days
        </span>
      </div>
      <span className="tabnum text-body ml-3 flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
        <Num amount={lot.gain} signed />
      </span>
    </div>
  )
}

// ── Harvesting section body ────────────────────────────────────────────────────

function HarvestingBody({
  equityLTCG,
  equitySTCG,
  unrealisedLoss,
  nearThreshold,
  pricesLoading,
}: {
  equityLTCG:     number
  equitySTCG:     number
  unrealisedLoss: number | null
  nearThreshold:  NearThresholdRow[]
  pricesLoading:  boolean
}) {
  const equityTotal      = equityLTCG + equitySTCG
  const netAfterHarvest  = equityTotal + (unrealisedLoss ?? 0)
  const barPct           = Math.min(100, Math.max(0, (netAfterHarvest / LTCG_EXEMPTION) * 100))
  const overThreshold    = netAfterHarvest > LTCG_EXEMPTION
  const barColor         = overThreshold ? 'var(--c-warning)' : 'var(--c-positive)'
  const netLabel         = unrealisedLoss !== null ? 'Net after harvesting' : 'Equity gains'

  return (
    <div className="pb-2">

      {/* LTCG Availability */}
      <SectionLabel label="LTCG Availability" className="px-4" />
      <DetailRow label={netLabel} bold noRupee><Num amount={netAfterHarvest} signed /></DetailRow>
      <div className="px-4 pb-3 pt-1">
        <div className="rounded-full overflow-hidden" style={{ height: 8, background: 'var(--border-faint)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: barColor }} />
        </div>
        <p className="text-footnote mt-1.5" style={{ color: 'var(--text-faint)' }}>1.25 L exemption threshold</p>
      </div>

      {/* Harvesting Availability */}
      <SectionLabel label="Harvesting Availability" className="px-4" />
      <DetailRow label="Harvestable losses" bold noRupee>
        {pricesLoading
          ? <span style={{ color: 'var(--text-faint)' }}>—</span>
          : unrealisedLoss !== null && unrealisedLoss < 0
            ? <Num amount={unrealisedLoss} signed />
            : <span style={{ color: 'var(--text-faint)' }}>None</span>
        }
      </DetailRow>
      <DetailRow label="Equity gains to offset" bold noRupee>
        {equityTotal > 0
          ? <Num amount={equityTotal} signed />
          : <span style={{ color: 'var(--text-faint)' }}>None</span>
        }
      </DetailRow>

      {/* Harvesting Readiness */}
      <SectionLabel label="Harvesting Readiness" className="px-4" />
      <p className="px-4 pb-2 text-footnote" style={{ color: 'var(--text-muted)' }}>
        Holdings within 30 days of the 1-year LTCG threshold — hold until they cross to avoid STCG.
      </p>
      {nearThreshold.length === 0 ? (
        <div className="px-4 pb-2">
          <p className="text-body" style={{ color: 'var(--text-faint)' }}>None approaching threshold</p>
        </div>
      ) : (
        nearThreshold.map((row, i) => (
          <div key={i} className="flex items-center justify-between px-4" style={{ minHeight: 48 }}>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-body font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {row.name}
              </span>
              <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>
                {row.position.holdingDays} days held · bought {formatDate(row.position.purchaseDate)}
              </span>
            </div>
            <span className="tabnum text-body ml-3 flex-shrink-0 font-semibold"
                  style={{ color: row.daysToLTCG <= 7 ? 'var(--c-warning)' : 'var(--text-primary)' }}>
              {row.daysToLTCG}d
            </span>
          </div>
        ))
      )}

    </div>
  )
}

// ── Export section ─────────────────────────────────────────────────────────────

function TableIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M3 9h18M3 15h18M9 9v10M15 9v10" />
    </svg>
  )
}

function DocumentIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v6h6M9 13h6M9 17h4" />
    </svg>
  )
}

function ExportBody({ detailRows, selectedFY }: { detailRows: SellRow[]; selectedFY: import('@/lib/types').FiscalYear | null }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [exporting, setExporting]  = useState<'pdf' | null>(null)
  const fyLabel = selectedFY?.label ?? 'FY'

  function handleCSV() {
    generateCSV(detailRows, fyLabel)
    setSheetOpen(false)
  }

  async function handlePDF() {
    setExporting('pdf')
    try {
      await generatePDF(detailRows, fyLabel)
    } finally {
      setExporting(null)
      setSheetOpen(false)
    }
  }

  return (
    <div className="px-4 pt-3 pb-4">
      <p className="text-body pb-4" style={{ color: 'var(--text-muted)' }}>
        Download your capital gains statement — lot-level detail for filing or sharing with your CA.
      </p>
      <button
        onClick={() => setSheetOpen(true)}
        className="w-full rounded-full text-body font-semibold"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', minHeight: 50 }}>
        Export
      </button>
      {sheetOpen && (
        <ExportSheet
          onClose={() => setSheetOpen(false)}
          onCSV={handleCSV}
          onPDF={handlePDF}
          exporting={exporting}
        />
      )}
    </div>
  )
}

function ExportSheet({
  onClose, onCSV, onPDF, exporting,
}: {
  onClose:   () => void
  onCSV:     () => void
  onPDF:     () => void
  exporting: 'pdf' | null
}) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="px-5 pt-1 pb-2">
        <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>Export</p>
      </div>
      <div style={{ height: 1, background: 'var(--border-faint)' }} />

      {/* CSV row */}
      <button
        onClick={onCSV}
        disabled={exporting !== null}
        className="flex items-center w-full px-5 tap-row"
        style={{ minHeight: 62 }}>
        <div className="flex items-center justify-center rounded-xl mr-4 flex-shrink-0"
             style={{ width: 40, height: 40, background: 'color-mix(in srgb, var(--c-positive) 15%, transparent)' }}>
          <TableIcon style={{ width: 20, height: 20, color: 'var(--c-positive)' }} />
        </div>
        <div className="flex flex-col gap-0.5 items-start flex-1 min-w-0">
          <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>CSV Spreadsheet</span>
          <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>Lot-level gains, all asset types</span>
        </div>
        <ChevronRightIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
      </button>

      <div style={{ height: 1, background: 'var(--border-faint)', marginLeft: 69 }} />

      {/* PDF row */}
      <button
        onClick={onPDF}
        disabled={exporting !== null}
        className="flex items-center w-full px-5 tap-row"
        style={{ minHeight: 62 }}>
        <div className="flex items-center justify-center rounded-xl mr-4 flex-shrink-0"
             style={{ width: 40, height: 40, background: 'color-mix(in srgb, var(--c-negative) 12%, transparent)' }}>
          <DocumentIcon style={{ width: 20, height: 20, color: 'var(--c-negative)' }} />
        </div>
        <div className="flex flex-col gap-0.5 items-start flex-1 min-w-0">
          <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>
            {exporting === 'pdf' ? 'Generating…' : 'PDF Statement'}
          </span>
          <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>CAMS-style capital gains statement</span>
        </div>
        <ChevronRightIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
      </button>
    </BottomSheet>
  )
}

// ── CSV export ─────────────────────────────────────────────────────────────────

function generateCSV(rows: SellRow[], fyLabel: string): void {
  const esc = (v: string | number) => {
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }

  const lines: string[] = [
    `Capital Gains Statement - ${fyLabel}`,
    `Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    '',
  ]

  const colHeaders = ['SNo', 'Symbol / Fund', 'Units', 'Purchase Date', 'Purchase Value (INR)', 'Sale Date', 'Sale Proceeds (INR)', 'STCG (INR)', 'LTCG (INR)']
  const assetGroups: [AssetType, string][] = [['stock', 'STOCKS'], ['mf', 'MUTUAL FUNDS'], ['gold', 'GOLD']]

  let grandSTCG = 0, grandLTCG = 0

  for (const [assetType, groupLabel] of assetGroups) {
    const groupRows = rows.filter(r => r.assetType === assetType)
    if (groupRows.length === 0) continue

    lines.push(groupLabel)
    lines.push(colHeaders.map(esc).join(','))

    let sno = 1, groupSTCG = 0, groupLTCG = 0

    for (const sellRow of groupRows) {
      for (const lot of sellRow.lots) {
        const stcg = lot.gainType === 'STCG' ? lot.gain : 0
        const ltcg = lot.gainType === 'LTCG' ? lot.gain : 0
        groupSTCG += stcg
        groupLTCG += ltcg
        const qty = Number.isInteger(lot.qty) ? String(lot.qty) : lot.qty.toFixed(3).replace(/\.?0+$/, '')
        lines.push([
          sno++, esc(sellRow.name), qty,
          lot.purchaseDate, lot.purchaseCost.toFixed(2),
          lot.sellDate, lot.saleValue.toFixed(2),
          stcg.toFixed(2), ltcg.toFixed(2),
        ].join(','))
      }
    }

    grandSTCG += groupSTCG
    grandLTCG += groupLTCG
    lines.push(['', 'Total', '', '', '', '', '', groupSTCG.toFixed(2), groupLTCG.toFixed(2)].join(','))
    lines.push('')
  }

  lines.push(['GRAND TOTAL', '', '', '', '', '', '', grandSTCG.toFixed(2), grandLTCG.toFixed(2)].join(','))

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `capital-gains-${fyLabel}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── PDF export ─────────────────────────────────────────────────────────────────

async function generatePDF(rows: SellRow[], fyLabel: string): Promise<void> {
  const { jsPDF }     = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')

  const doc       = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin    = 14
  const fmtINR    = (n: number) => n.toFixed(2)
  const fmtQty    = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')

  // Header
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Capital Gains Statement', pageWidth / 2, 20, { align: 'center' })
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(fyLabel, pageWidth / 2, 28, { align: 'center' })
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text(
    `Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    pageWidth / 2, 34, { align: 'center' }
  )
  doc.setTextColor(0)

  let curY = 44
  const colHeaders = ['SNo', 'Units', 'Purchase Date', 'Purchase Value', 'Sale Date', 'Sale Proceeds', 'STCG', 'LTCG']
  const colStyles = {
    0: { cellWidth: 10 },
    1: { cellWidth: 16, halign: 'right' as const },
    2: { cellWidth: 26 },
    3: { cellWidth: 27, halign: 'right' as const },
    4: { cellWidth: 26 },
    5: { cellWidth: 27, halign: 'right' as const },
    6: { cellWidth: 25, halign: 'right' as const },
    7: { cellWidth: 25, halign: 'right' as const },
  }

  const assetGroups: [AssetType, string][] = [['stock', 'Stocks'], ['mf', 'Mutual Funds'], ['gold', 'Gold']]
  let grandSTCG = 0, grandLTCG = 0

  for (const [assetType, groupLabel] of assetGroups) {
    const groupRows = rows.filter(r => r.assetType === assetType)
    if (groupRows.length === 0) continue

    let groupSTCG = 0, groupLTCG = 0

    // Section heading + underline
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(groupLabel, margin, curY)
    curY += 2
    doc.setDrawColor(180)
    doc.line(margin, curY, pageWidth - margin, curY)
    curY += 5

    // Group by symbol/fund (preserve order from detailRows)
    const seen = new Set<string>()
    const symbolOrder: { symbol: string; name: string }[] = []
    for (const r of groupRows) {
      if (!seen.has(r.symbol)) { seen.add(r.symbol); symbolOrder.push({ symbol: r.symbol, name: r.name }) }
    }

    for (const { symbol, name } of symbolOrder) {
      const symbolRows = groupRows.filter(r => r.symbol === symbol)
      let symSTCG = 0, symLTCG = 0
      let sno = 1

      const tableBody: string[][] = []
      for (const sellRow of symbolRows) {
        for (const lot of sellRow.lots) {
          const stcg = lot.gainType === 'STCG' ? lot.gain : 0
          const ltcg = lot.gainType === 'LTCG' ? lot.gain : 0
          symSTCG += stcg; symLTCG += ltcg
          groupSTCG += stcg; groupLTCG += ltcg
          tableBody.push([
            String(sno++),
            fmtQty(lot.qty),
            lot.purchaseDate,
            fmtINR(lot.purchaseCost),
            lot.sellDate,
            fmtINR(lot.saleValue),
            stcg !== 0 ? fmtINR(stcg) : '—',
            ltcg !== 0 ? fmtINR(ltcg) : '—',
          ])
        }
      }
      tableBody.push(['', '', '', '', 'Total', '', fmtINR(symSTCG), fmtINR(symLTCG)])

      // Fund/symbol name above table
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text(name, margin, curY)
      curY += 4

      const totalRowIdx = tableBody.length - 1
      autoTable(doc, {
        startY: curY,
        head: [colHeaders],
        body: tableBody,
        styles: { fontSize: 7, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 } },
        headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: colStyles,
        margin: { left: margin, right: margin },
        didParseCell: (data) => {
          if (data.section === 'body' && data.row.index === totalRowIdx) {
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.fillColor = [245, 245, 245]
          }
        },
      })

      curY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7
    }

    grandSTCG += groupSTCG
    grandLTCG += groupLTCG

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(
      `${groupLabel} Total — STCG: ${fmtINR(groupSTCG)}  LTCG: ${fmtINR(groupLTCG)}`,
      margin, curY
    )
    curY += 10
  }

  // Grand total
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(`Grand Total — STCG: ${fmtINR(grandSTCG)}  LTCG: ${fmtINR(grandLTCG)}`, margin, curY)

  doc.save(`capital-gains-${fyLabel}.pdf`)
}
