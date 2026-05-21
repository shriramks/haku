'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import type { FiscalYear, Transaction, DividendTransaction } from '@/lib/types'
import type { MFund, MFTransaction, SGBTransaction } from '@/lib/portfolio-types'
import { computeStockGains, computeMFGains, computeGoldGains, mfAssetClass } from '@/lib/tax-compute'
import type { RealisedGain, GainType, AssetType, UnrealisedPosition } from '@/lib/tax-compute'
import { formatDate } from '@/lib/formatter'
import FYPicker from '@/components/FYPicker'
import BottomSheet from '@/components/BottomSheet'
import { Num } from '@/components/Num'
import { ChevronDownIcon } from '@/components/icons'
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

  const harvestingData = useMemo(() => {
    if (!fyRange) return { unrealisedLoss: null, nearThreshold: [] as NearThresholdRow[] }
    const asOf = new Date().toISOString().slice(0, 10)
    const positions: UnrealisedPosition[] = []

    const stockMap = new Map<string, Transaction[]>()
    for (const txn of stockTxns) {
      const arr = stockMap.get(txn.symbol) ?? []; arr.push(txn); stockMap.set(txn.symbol, arr)
    }
    for (const [symbol, txns] of stockMap) {
      const { unrealised } = computeStockGains(txns, symbol, cmps[symbol] ?? null, fyRange, asOf)
      positions.push(...unrealised)
    }

    const mfMap = new Map<string, MFTransaction[]>()
    for (const txn of mfTxns) {
      const arr = mfMap.get(txn.fund_id) ?? []; arr.push(txn); mfMap.set(txn.fund_id, arr)
    }
    for (const [fundId, txns] of mfMap) {
      const fund = mfFunds.find(f => f.id === fundId)
      const nav = fund ? (navs[fund.scheme_code] ?? null) : null
      const { unrealised } = computeMFGains(txns, fundId, null, nav, fyRange, asOf)
      positions.push(...unrealised)
    }

    const goldMap = new Map<string, SGBTransaction[]>()
    for (const txn of sgbTxns) {
      const arr = goldMap.get(txn.gold_type) ?? []; arr.push(txn); goldMap.set(txn.gold_type, arr)
    }
    for (const [goldType, txns] of goldMap) {
      const { unrealised } = computeGoldGains(txns, goldType, goldPrice, fyRange, asOf)
      positions.push(...unrealised)
    }

    const equityPositions = positions.filter(p => {
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
        const name = fund ? fund.scheme_name : p.symbol
        return { position: p, daysToLTCG, name }
      })
      .sort((a, b) => a.daysToLTCG - b.daysToLTCG)

    return { unrealisedLoss, nearThreshold }
  }, [fyRange, stockTxns, mfTxns, mfFunds, sgbTxns, cmps, navs, goldPrice])

  const { equityLTCG, equitySTCG, debtLTCG, debtSTCG, goldLTCG, goldSTCG, dividendIncome } = useMemo(() => {
    if (!fyRange) return { equityLTCG: 0, equitySTCG: 0, debtLTCG: 0, debtSTCG: 0, goldLTCG: 0, goldSTCG: 0, dividendIncome: 0 }

    const asOf = new Date().toISOString().slice(0, 10)
    let eqLTCG = 0, eqSTCG = 0, dtLTCG = 0, dtSTCG = 0, gdLTCG = 0, gdSTCG = 0

    // Stocks → equity
    const stockMap = new Map<string, Transaction[]>()
    for (const txn of stockTxns) {
      const arr = stockMap.get(txn.symbol) ?? []; arr.push(txn); stockMap.set(txn.symbol, arr)
    }
    for (const [symbol, txns] of stockMap) {
      const { realised } = computeStockGains(txns, symbol, null, fyRange, asOf)
      for (const g of realised) {
        if (g.gainType === 'LTCG') eqLTCG += g.gain; else eqSTCG += g.gain
      }
    }

    // MF — split equity vs debt by fund classification
    const mfMap = new Map<string, MFTransaction[]>()
    for (const txn of mfTxns) {
      const arr = mfMap.get(txn.fund_id) ?? []; arr.push(txn); mfMap.set(txn.fund_id, arr)
    }
    for (const [fundId, txns] of mfMap) {
      const fund = mfFunds.find(f => f.id === fundId)
      const cls  = fund ? mfAssetClass(fund) : 'equity'
      const { realised } = computeMFGains(txns, fundId, null, null, fyRange, asOf)
      for (const g of realised) {
        if (cls === 'debt') {
          if (g.gainType === 'LTCG') dtLTCG += g.gain; else dtSTCG += g.gain
        } else {
          if (g.gainType === 'LTCG') eqLTCG += g.gain; else eqSTCG += g.gain
        }
      }
    }

    // Gold
    const goldMap = new Map<string, SGBTransaction[]>()
    for (const txn of sgbTxns) {
      const arr = goldMap.get(txn.gold_type) ?? []; arr.push(txn); goldMap.set(txn.gold_type, arr)
    }
    for (const [goldType, txns] of goldMap) {
      const { realised } = computeGoldGains(txns, goldType, null, fyRange, asOf)
      for (const g of realised) {
        if (g.gainType === 'LTCG') gdLTCG += g.gain; else gdSTCG += g.gain
      }
    }

    const divIncome = dividends
      .filter(d => d.ex_date >= fyRange.start && d.ex_date <= fyRange.end)
      .reduce((s, d) => s + d.amount, 0)

    return { equityLTCG: eqLTCG, equitySTCG: eqSTCG, debtLTCG: dtLTCG, debtSTCG: dtSTCG, goldLTCG: gdLTCG, goldSTCG: gdSTCG, dividendIncome: divIncome }
  }, [fyRange, stockTxns, mfTxns, mfFunds, sgbTxns, dividends])

  const detailRows = useMemo<SellRow[]>(() => {
    if (!fyRange) return []
    const asOf = new Date().toISOString().slice(0, 10)
    const rows: SellRow[] = []

    function groupBySell(gained: RealisedGain[], assetType: AssetType, symbol: string, name: string) {
      const bySell = new Map<string, RealisedGain[]>()
      for (const g of gained) {
        const arr = bySell.get(g.sellDate) ?? []
        arr.push(g)
        bySell.set(g.sellDate, arr)
      }
      for (const [sellDate, lots] of bySell) {
        const totalGain = lots.reduce((s, g) => s + g.gain, 0)
        const hasLTCG   = lots.some(g => g.gainType === 'LTCG')
        const hasSTCG   = lots.some(g => g.gainType === 'STCG')
        const gainType: GainType | 'mixed' = hasLTCG && hasSTCG ? 'mixed' : hasLTCG ? 'LTCG' : 'STCG'
        const days      = lots.map(g => g.holdingDays)
        rows.push({ assetType, symbol, name, sellDate, lots, totalGain, gainType, minDays: Math.min(...days), maxDays: Math.max(...days) })
      }
    }

    // Stocks
    const stockMap = new Map<string, Transaction[]>()
    for (const txn of stockTxns) {
      const arr = stockMap.get(txn.symbol) ?? []; arr.push(txn); stockMap.set(txn.symbol, arr)
    }
    for (const [symbol, txns] of stockMap) {
      const { realised } = computeStockGains(txns, symbol, null, fyRange, asOf)
      groupBySell(realised, 'stock', symbol, symbol)
    }

    // MF
    const mfMap = new Map<string, MFTransaction[]>()
    for (const txn of mfTxns) {
      const arr = mfMap.get(txn.fund_id) ?? []; arr.push(txn); mfMap.set(txn.fund_id, arr)
    }
    for (const [fundId, txns] of mfMap) {
      const fund = mfFunds.find(f => f.id === fundId)
      const { realised } = computeMFGains(txns, fundId, null, null, fyRange, asOf)
      groupBySell(realised, 'mf', fundId, fund?.scheme_name ?? fundId)
    }

    // Gold
    const goldMap = new Map<string, SGBTransaction[]>()
    for (const txn of sgbTxns) {
      const arr = goldMap.get(txn.gold_type) ?? []; arr.push(txn); goldMap.set(txn.gold_type, arr)
    }
    for (const [goldType, txns] of goldMap) {
      const { realised } = computeGoldGains(txns, goldType, null, fyRange, asOf)
      groupBySell(realised, 'gold', goldType, goldType)
    }

    // Sort: asset type order (stock → mf → gold), then newest sell first within each
    const order: Record<AssetType, number> = { stock: 0, mf: 1, gold: 2 }
    rows.sort((a, b) => {
      if (a.assetType !== b.assetType) return order[a.assetType] - order[b.assetType]
      return b.sellDate.localeCompare(a.sellDate)
    })
    return rows
  }, [fyRange, stockTxns, mfTxns, mfFunds, sgbTxns])

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
