'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { computeStockRows, type AllTimeHolding } from '@/lib/compute'
import { sleeveBudget, stockAllocations } from '@/lib/sleeves'
import { allocationSections, fundLine, ppfLine, stockLine, stripTotals } from '@/lib/allocation-sections'
import type { StockPriceInfo } from '@/lib/stock-prices'
import { getFYData } from '@/app/actions'
import { Num } from '@/components/Num'
import { ChevronRightIcon } from '@/components/icons'
import type { FiscalYear, StockAllocation, FYTxn, BuyBand } from '@/lib/types'
import UserMenu from '@/components/UserMenu'
import FYPicker from '@/components/FYPicker'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { ProgressBar } from '@/components/ProgressBar'
import { AllocationSection, AllocationRowView, ALLOCATION_COLS } from './AllocationSection'

interface Props {
  fiscalYears: FiscalYear[]
  initialFY: FiscalYear | null
  initialAllocations: StockAllocation[]
  initialTransactions: FYTxn[]
  /** PPF deposits dated in the initial FY — what the PPF plan row has invested. */
  initialPPFInvested: number
  /** FY net MF buys by AMFI scheme code — the fund rows' Invested. */
  initialFundInvested: Record<string, number>
  /** Holding id by scheme code; a fund row with none opens Portfolio. */
  fundIds: Record<string, string>
  allTimeHoldings: Record<string, AllTimeHolding>
  bands: BuyBand[]
  /** Saved stock_prices by symbol — resolveCmp prefers these over the band snapshot. */
  prices: Record<string, StockPriceInfo>
  /** INR per unit of an overseas instrument's quote currency; a symbol not listed is INR. */
  inrRates: Record<string, number | null>
}

export default function DashboardClient({ fiscalYears, initialFY, initialAllocations, initialTransactions, initialPPFInvested, initialFundInvested, fundIds, allTimeHoldings, bands, prices, inrRates }: Props) {
  const [selectedFY, setSelectedFY]     = useState(initialFY)
  const [allocations, setAllocations]   = useState(initialAllocations)
  const [transactions, setTransactions] = useState<FYTxn[]>(initialTransactions)
  const [ppfInvested, setPPFInvested]   = useState(initialPPFInvested)
  const [fundInvested, setFundInvested] = useState(initialFundInvested)
  const [loading, setLoading]           = useState(false)

  // The plan's tree: stock rows (Equity) and the PPF row (Debt), each at its sleeve's budget.
  const sections = useMemo(() => {
    const stockRows = computeStockRows(
      stockAllocations(allocations), transactions, bands,
      sleeveBudget(selectedFY, 'equity'),
      allTimeHoldings, prices, inrRates,
    )
    const fyLabel = selectedFY?.label ?? ''
    const ppf = allocations.find(a => a.kind === 'ppf')
    return allocationSections(
      stockRows.map(r => stockLine(r, fyLabel)),
      [
        ...(ppf ? [ppfLine(ppf, selectedFY, ppfInvested)] : []),
        ...allocations.filter(a => a.kind === 'mf')
          .map(a => fundLine(a, selectedFY, fundInvested[a.symbol] ?? 0, fundIds[a.symbol] ?? null)),
      ],
    )
  }, [allocations, transactions, bands, selectedFY, ppfInvested, fundInvested, fundIds, allTimeHoldings, prices, inrRates])

  async function switchFY(fy: FiscalYear) {
    setSelectedFY(fy)
    setLoading(true)
    window.history.replaceState(null, '', `/allocation?fy=${encodeURIComponent(fy.label)}`)

    const { allocations: alloc, transactions: txns, ppfInvested: ppf, fundInvested: funds } = await getFYData(fy.id)
    setAllocations(alloc)
    setTransactions(txns)
    setPPFInvested(ppf)
    setFundInvested(funds)
    setLoading(false)
  }

  // Invested pairs (amount + %) come from currentCost; Left pairs from budget − spent. Different measures
  // by design (see app-spec investment math), so the two percentages need not sum to 100.
  const { budget: totalBudget, invested: totalDeployed, remaining: totalRemaining, pctInvested: pctDeployed, pctLeft } =
    useMemo(() => stripTotals(sections), [sections])

  // ── Pinning ──────────────────────────────────────────────────────────────────
  // The page header always sticks. Once the full strip has scrolled under it, a trimmed copy of the strip
  // joins it, and the current section's header pins beneath both (`--alloc-pin` is their combined height).
  const headerRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const compactRef = useRef(false)
  const [compact, setCompact] = useState(false)
  const [pinTop, setPinTop] = useState(0)
  const [baseHeight, setBaseHeight] = useState(0)   // the page header alone, without the trimmed strip

  useEffect(() => {
    const el = headerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height)
      setPinTop(h)
      if (!compactRef.current) setBaseHeight(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hasFY = !!selectedFY
  useEffect(() => {
    const strip = stripRef.current
    if (!strip || !baseHeight || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => {
      // gone = the strip is entirely above the line where the page header ends
      const gone = !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? baseHeight)
      compactRef.current = gone
      setCompact(gone)
    }, { rootMargin: `-${baseHeight}px 0px 0px 0px`, threshold: 0 })
    io.observe(strip)
    return () => io.disconnect()
  }, [baseHeight, hasFY])

  return (
    <div style={{ minHeight: '100dvh', ['--alloc-pin' as string]: `${pinTop}px` } as React.CSSProperties}>
      {/* Header */}
      <div
        ref={headerRef}
        className="sticky top-0 z-10 backdrop-blur-xl px-4 pb-3"
        style={{
          background: 'var(--bg-nav)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-display font-bold">Allocation</h1>
          <div className="flex items-center gap-2">
            <FYPicker
              fiscalYears={fiscalYears}
              selectedFY={selectedFY}
              onSelect={switchFY}
            />
            <UserMenu />
          </div>
        </div>

        {/* The strip, trimmed, once the full one has scrolled away */}
        {compact && selectedFY && (
          <div className="pt-3">
            <div className="grid mb-2" style={{ gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'start' }}>
              <div className="flex flex-col gap-0.5">
                <p className="label-field">Plan</p>
                <p className="text-title-1 font-bold tabnum"><Num amount={totalBudget} /></p>
              </div>
              <div className="flex flex-col gap-0.5 items-center">
                <p className="label-field">Left</p>
                <p className="text-title-1 font-bold tabnum"><Num amount={Math.max(0, totalRemaining)} /></p>
              </div>
              <div className="flex flex-col gap-0.5 items-end">
                <p className="label-field">Invested</p>
                <p className="text-title-1 font-bold tabnum"><Num amount={totalDeployed} /></p>
              </div>
            </div>
            <ProgressBar percent={Math.min(100, pctDeployed)} />
          </div>
        )}
      </div>

      {/* Summary strip — Plan | Left | Invested + bar */}
      {selectedFY && (
        <div ref={stripRef} className="px-4 pt-4 pb-3" style={{ background: 'var(--bg-primary)' }}>
          {/* Three stat columns, top-aligned */}
          <div className="grid mb-3" style={{ gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'start' }}>

            {/* Plan — tappable, navigates to /plan */}
            <Link href="/plan" className="flex flex-col gap-0.5" style={{ minHeight: 44, justifyContent: 'center' }}>
              <p className="label-field">Plan</p>
              <p className="text-title-1 font-bold tabnum" style={{ marginTop: 2 }}>
                <Num amount={totalBudget} />
              </p>
              <span className="flex items-center gap-0.5" style={{ marginTop: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}>Edit plan</span>
                <ChevronRightIcon className="w-2.5 h-2.5" style={{ color: 'var(--accent)' }} />
              </span>
            </Link>
            {/* Left */}
            <div className="flex flex-col gap-0.5 items-center">
              <p className="label-field">Left</p>
              <p className="text-title-1 font-bold tabnum" style={{ marginTop: 2 }}>
                <Num amount={Math.max(0, totalRemaining)} />
              </p>
              <p className="text-footnote tabnum" style={{ color: 'var(--text-muted)', marginTop: 1 }}>
                <Num pct={pctLeft} />
              </p>
            </div>
            {/* Invested */}
            <div className="flex flex-col gap-0.5 items-end">
              <p className="label-field">Invested</p>
              <p className="text-title-1 font-bold tabnum" style={{ marginTop: 2 }}>
                <Num amount={totalDeployed} />
              </p>
              <p className="text-footnote tabnum" style={{ color: 'var(--text-muted)', marginTop: 1 }}>
                <Num pct={pctDeployed} />
              </p>
            </div>

          </div>

          {/* Progress bar — invested portion */}
          <ProgressBar percent={Math.min(100, pctDeployed)} />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : sections.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
          <p className="text-headline font-medium mb-1">Nothing in this plan</p>
          <Link href="/plan" className="text-body text-accent">Add to the plan →</Link>
        </div>
      ) : (
        <div>
          {/* Column headers */}
          <div className="grid px-4 pt-4 pb-1"
               style={{ gridTemplateColumns: ALLOCATION_COLS }}>
            <span className="label-field" />
            <span className="label-field text-center">Left</span>
            <span className="label-field text-right">Invested</span>
          </div>
          {sections.map(section => (
            <AllocationSection key={section.sleeve} section={section}>
              {section.lines.map(line => <AllocationRowView key={line.key} line={line} />)}
            </AllocationSection>
          ))}

          <div style={{ height: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }} />
        </div>
      )}
    </div>
  )
}
