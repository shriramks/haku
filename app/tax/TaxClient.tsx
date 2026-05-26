'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import type { FiscalYear, Transaction, DividendTransaction } from '@/lib/types'
import type { MFund, MFTransaction, SGBTransaction } from '@/lib/portfolio-types'
import { computeStockGains, computeMFGains, computeGoldGains, mfAssetClass, groupBy, netStockQty } from '@/lib/tax-compute'
import type { RealisedGain, GainType, AssetType, UnrealisedPosition } from '@/lib/tax-compute'
import FYPicker from '@/components/FYPicker'
import { Num } from '@/components/Num'
import UserMenu from '@/components/UserMenu'
import { LTCG_EXEMPTION } from './tax-export'
import type { SellRow } from './tax-export'
import { Section, SummaryBody, DetailsBody, HarvestingBody } from './TaxSections'
import type { SectionKey, NearThresholdRow } from './TaxSections'
import { ExportBody } from './TaxExport'

interface Props {
  fiscalYears:  FiscalYear[]
  currentFY:    FiscalYear | null
  stockTxns:    Transaction[]
  mfFunds:      MFund[]
  mfTxns:       MFTransaction[]
  sgbTxns:      SGBTransaction[]
  dividends:    DividendTransaction[]
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
  const [selectedFY, setSelectedFY]       = useState<FiscalYear | null>(currentFY)
  const [expanded, setExpanded]           = useState<Set<SectionKey>>(new Set(['summary']))
  const [cmps, setCmps]                   = useState<Record<string, number>>({})
  const [navs, setNavs]                   = useState<Record<string, number>>({})
  const [goldPrice, setGoldPrice]         = useState<number | null>(null)
  const [pricesLoading, setPricesLoading] = useState(false)
  const pricesFetchedRef                  = useRef(false)

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
      if (p.assetType === 'stock') {
        return netStockQty(stockMap.get(p.symbol) ?? []) > 0
      }
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
