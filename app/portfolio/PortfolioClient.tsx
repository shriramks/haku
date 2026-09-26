'use client'

import React, { useState, useMemo, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { trimZero, fyLabel, monthYear, formatDate } from '@/lib/formatter'
import { TxnRow, ppfToDisplayTxn, epfToDisplayTxn } from '@/components/EditableTxnRow'
import { Num, NumUnit } from '@/components/Num'
import { HoldingRow } from '@/components/HoldingRow'
import HoldingsToolbar, { type ToolbarPill } from '@/components/HoldingsToolbar'
import { DEFAULT_SORT, nextSort, sortHoldings, type SortState } from '@/lib/holdings-sort'
import { CheckIcon, ChevronRightIcon, RefreshIcon } from '@/components/icons'
import EmptyState from '@/components/EmptyState'
import UserMenu from '@/components/UserMenu'
import type { PortfolioData } from '@/lib/portfolio-compute'
import type { PPFTransaction, EPFTransaction } from '@/lib/portfolio-types'

// Holdings, totals and XIRR arrive finished in `data` (lib/portfolio-compute.ts, built in page.tsx —
// progress log #125). The client keeps only what is interactive: sort, filter, open sections, the
// Prices button, and the PPF/EPF lists, which it edits in place.
interface Props {
  data: PortfolioData
  pricesStale: boolean                   // server-computed: newest saved stock/gold price predates the last market close
  ppfTransactions: PPFTransaction[]
  epfTransactions: EPFTransaction[]
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortfolioClient({
  data, pricesStale, ppfTransactions: initialPpfTransactions, epfTransactions: initialEpfTransactions,
}: Props) {
  const router = useRouter()
  const { summary, stocks, mf, gold, ppf, epf } = data
  const [openSections, setOpenSections] = useState(new Set<string>())
  // Sort is per section and not persisted; the MF filter is one class or none.
  const [stockSort, setStockSort] = useState<SortState>(DEFAULT_SORT)
  const [mfSort, setMfSort] = useState<SortState>(DEFAULT_SORT)
  const [mfFilter, setMfFilter] = useState<'equity' | 'debt' | null>(null)
  const [ppfTxns, setPpfTxns] = useState(initialPpfTransactions)
  const [epfTxns, setEpfTxns] = useState(initialEpfTransactions)
  const [posting, setPosting] = useState(false)
  const [refreshPending, startRefresh] = useTransition()
  const refreshing = posting || refreshPending
  // Outcome of the last tap, for the button: 'updated' shows a check for ~2 s; 'partial' (some prices
  // failed, or the request did) sticks as "Retry" until the next tap.
  const [refreshResult, setRefreshResult] = useState<'idle' | 'updated' | 'partial'>('idle')

  // Equity/Debt pills only when both classes are held (one class has nothing to filter against).
  // A filter left over from before a class was sold out is ignored rather than showing an empty list.
  const mfHasBothClasses = mf.rows.some(r => r.assetClass === 'equity') && mf.rows.some(r => r.assetClass === 'debt')
  const mfPills: ToolbarPill[] = [
    { key: 'equity', label: 'Equity', color: 'var(--c-equity)', pct: mf.eqPct },
    { key: 'debt',   label: 'Debt',   color: 'var(--c-debt)',   pct: 100 - mf.eqPct },
  ]
  const activeMfFilter = mfHasBothClasses ? mfFilter : null
  const visibleStockRows = useMemo(() => sortHoldings(stocks.rows, stockSort), [stocks.rows, stockSort])
  const visibleMfRows = useMemo(
    () => sortHoldings(activeMfFilter ? mf.rows.filter(r => r.assetClass === activeMfFilter) : mf.rows, mfSort),
    [mf.rows, activeMfFilter, mfSort],
  )

  // Fetch + save the latest prices server-side, then re-render so the page reads them back.
  // A failed POST still re-renders (harmlessly, with whatever is saved) — the transition
  // keeps the button busy until the new server render has actually landed. The button reports
  // the outcome: some prices failing (or the request failing) leaves it on "Retry".
  async function handleRefresh() {
    setPosting(true)
    let outcome: 'updated' | 'partial' = 'partial'
    try {
      const res = await fetch('/api/portfolio/prices/refresh', { method: 'POST' })
      if (res.ok) {
        const body = await res.json() as { stocks?: { failed?: unknown[] }; gold?: string }
        outcome = (body.stocks?.failed?.length ?? 0) > 0 || body.gold === 'failed' ? 'partial' : 'updated'
      }
    } catch { /* outcome stays 'partial'; fall through to the re-render below */ }
    setRefreshResult(outcome)
    startRefresh(() => router.refresh())
    setPosting(false)
  }

  // The "Updated" flash lasts ~2 s counted from when the new render has landed, not from the tap.
  useEffect(() => {
    if (refreshResult !== 'updated' || refreshing) return
    const t = setTimeout(() => setRefreshResult('idle'), 2000)
    return () => clearTimeout(t)
  }, [refreshResult, refreshing])

  // The Prices button doubles as the status — no caption line. Fresh is silent; an amber dot means
  // the saved prices are due (or some failed); see docs/design.md and progress log #121.b.
  const pricesButton = refreshing ? 'updating'
    : refreshResult === 'updated' ? 'updated'
    : refreshResult === 'partial' ? 'retry'
    : pricesStale ? 'stale' : 'fresh'
  const pricesLabel = { updating: 'Updating…', updated: 'Updated', retry: 'Retry', stale: 'Prices', fresh: 'Prices' }[pricesButton]

  function toggleSection(id: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function updatePPFTxn(u: PPFTransaction) { setPpfTxns(prev => prev.map(t => t.id === u.id ? u : t)) }
  function updateEPFTxn(u: EPFTransaction) { setEpfTxns(prev => prev.map(t => t.id === u.id ? u : t)) }
  function deletePPFTxn(id: string) { setPpfTxns(prev => prev.filter(t => t.id !== id)) }
  function deleteEPFTxn(id: string) { setEpfTxns(prev => prev.filter(t => t.id !== id)) }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl border-b flex items-center px-2"
           style={{ background: 'var(--bg-nav)', borderColor: 'var(--border-faint)', paddingTop: 'max(env(safe-area-inset-top,0px), 14px)', paddingBottom: 12 }}>
        <Link href="/allocation"
              className="flex items-center justify-center min-w-[44px] min-h-[44px]"
              style={{ color: 'var(--accent)' }}>
          <svg width="11" height="19" viewBox="0 0 11 19" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 1.5L1.5 9.5L9 17.5" />
          </svg>
        </Link>
        <h1 className="text-display font-bold flex-1 pl-1">Portfolio</h1>
        <button onClick={handleRefresh} disabled={refreshing}
                aria-label={pricesButton === 'stale' ? 'Refresh prices — saved prices are out of date'
                  : pricesButton === 'retry' ? 'Retry — some prices did not update' : undefined}
                className="flex items-center gap-1.5 text-accent text-body rounded-lg px-2.5 min-h-[44px] disabled:opacity-40 mr-1.5"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <span className="relative inline-flex">
            {pricesButton === 'updated'
              ? <CheckIcon className="w-4 h-4" />
              : <RefreshIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}
            {(pricesButton === 'stale' || pricesButton === 'retry') && (
              <span className="absolute rounded-full"
                    style={{ top: -3, right: -4, width: 8, height: 8, background: 'var(--c-warning)', border: '1.5px solid var(--bg-secondary)' }} />
            )}
          </span>
          {pricesLabel}
        </button>
        <UserMenu />
      </div>

      {/* Summary: 3-col grid — no justify-between stretch */}
      <div className="grid px-4 py-2 border-b"
           style={{ gridTemplateColumns: '1fr 1fr auto', gap: '0', borderColor: 'var(--border-faint)' }}>
        <div className="flex flex-col gap-2">
          <SCell label="Current Value" amount={summary.totalCurrent} />
          <SCell label="Gain" amount={summary.totalGain} signed />
          <SCell label="1D Gain" amount={summary.totalGain1d} signed />
        </div>
        <div className="flex flex-col gap-2 pl-4" style={{ marginLeft: 8 }}>
          <SCell label="Invested" amount={summary.totalInvested} />
          <SCell label="XIRR p.a." pct={summary.xirr !== null ? summary.xirr * 100 : null} signed />
          <SCell label="1D %" pct={summary.dayPct} signed />
        </div>
        <FilledPieChart equity={summary.eqPct} debt={summary.debtPct} gold={summary.goldPct} />
      </div>

      {/* Scrollable sections */}
      <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

        {/* EQUITY */}
        <SectionHeader
          id="equity" label="Stocks"
          invested={stocks.invested !== null ? <Num amount={stocks.invested} align /> : null}
          gainPct={stocks.gainPct}
          currentValue={stocks.currentValue}
          open={openSections.has('equity')}
          onToggle={() => toggleSection('equity')}
        />
        {openSections.has('equity') && (
          <>
            {visibleStockRows.length > 0 && (
              <>
                {stocks.rows.length >= 2 && (
                  <HoldingsToolbar sort={stockSort} onSort={k => setStockSort(cur => nextSort(cur, k))} />
                )}
                {visibleStockRows.map(r => (
                  <HoldingRow key={r.key} row={r} onClick={() => router.push(r.href)} />
                ))}
              </>
            )}
            {stocks.rows.length === 0 && (
              <EmptyState>No stock holdings yet.</EmptyState>
            )}
          </>
        )}

        {/* MUTUAL FUNDS */}
        <SectionHeader
          id="mf" label="MF"
          invested={mf.invested !== null ? <Num amount={mf.invested} align /> : null}
          gainPct={mf.gainPct}
          currentValue={mf.currentValue}
          open={openSections.has('mf')}
          onToggle={() => toggleSection('mf')}
        />
        {openSections.has('mf') && (
          <>
            {mf.rows.length > 0 && (
              <>
                {(mfHasBothClasses || mf.rows.length >= 2) && (
                  <HoldingsToolbar
                    sort={mfSort} onSort={k => setMfSort(cur => nextSort(cur, k))}
                    pills={mfHasBothClasses ? mfPills : undefined}
                    activePill={activeMfFilter}
                    onPill={k => setMfFilter(cur => (cur === k ? null : k as 'equity' | 'debt'))} />
                )}
                {visibleMfRows.map(r => (
                  <HoldingRow key={r.key} row={r} onClick={() => router.push(r.href)} />
                ))}
              </>
            )}
            {mf.rows.length === 0 && (
              <EmptyState>No mutual fund holdings yet.</EmptyState>
            )}
          </>
        )}

        {/* Gold */}
        <SectionHeader
          id="sgb" label="Gold"
          invested={gold.grams !== null ? <NumUnit digits={trimZero(gold.grams)} unit="g" /> : null}
          gainPct={gold.gainPct}
          currentValue={gold.currentValue}
          open={openSections.has('sgb')}
          onToggle={() => toggleSection('sgb')}
        />
        {openSections.has('sgb') && (
          <>
            {gold.rows.map(r => (
              <HoldingRow key={r.key} row={r} onClick={() => router.push(r.href)} />
            ))}
            {gold.rows.length === 0 && (
              <EmptyState>No gold holdings yet.</EmptyState>
            )}
          </>
        )}

        {/* PPF */}
        <SectionHeader
          id="ppf" label="PPF"
          invested={ppf.invested !== null ? <Num amount={ppf.invested} align /> : null}
          gainPct={ppf.gainPct}
          currentValue={ppf.currentValue}
          open={openSections.has('ppf')}
          onToggle={() => toggleSection('ppf')}
        />
        {openSections.has('ppf') && (
          <PPFRow transactions={ppfTxns} onSaved={updatePPFTxn} onDeleted={deletePPFTxn} />
        )}

        {/* EPF */}
        <SectionHeader
          id="epf" label="EPF"
          invested={epf.invested !== null ? <Num amount={epf.invested} align /> : null}
          gainPct={epf.gainPct}
          currentValue={epf.currentValue}
          open={openSections.has('epf')}
          onToggle={() => toggleSection('epf')}
        />
        {openSections.has('epf') && (
          <EPFRow transactions={epfTxns} onSaved={updateEPFTxn} onDeleted={deleteEPFTxn} />
        )}

        {/* Reports */}
        <div className="px-4" style={{ paddingTop: 24, paddingBottom: 6 }}>
          <span className="text-subheadline font-bold uppercase" style={{ color: 'var(--text-2)', letterSpacing: '0.08em' }}>Reports</span>
        </div>
        <button
          onClick={() => router.push('/tax')}
          className="flex items-center gap-3 w-full px-4 tap-row"
          style={{ minHeight: 52 }}>
          <span className="flex items-center justify-center flex-shrink-0"
                style={{ width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14l2 2 4-4M7 3H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2h-2M9 3h6a1 1 0 010 2H9a1 1 0 010-2z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>Tax Report</p>
            <p className="text-subheadline" style={{ color: 'var(--text-2)' }}>Capital gains</p>
          </div>
          <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
        </button>
        <button
          onClick={() => router.push('/dividends')}
          className="flex items-center gap-3 w-full px-4 tap-row"
          style={{ minHeight: 52 }}>
          <span className="flex items-center justify-center flex-shrink-0"
                style={{ width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>Dividends</p>
            <p className="text-subheadline" style={{ color: 'var(--text-2)' }}>Income received</p>
          </div>
          <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
        </button>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SCell({ label, amount, pct, signed }: {
  label: string
  amount?: number | null
  pct?: number | null
  signed?: boolean
}) {
  const val = amount !== undefined ? amount : pct
  const positive = signed && val !== null && val !== undefined && val > 0
  const negative = signed && val !== null && val !== undefined && val < 0
  return (
    <div className="flex flex-col gap-1">
      <p className="text-subheadline" style={{ color: 'var(--text-2)', letterSpacing: '0.02em' }}>{label}</p>
      <p className="text-title-1 font-bold tabnum"
         style={{ color: positive ? 'var(--c-positive)' : negative ? 'var(--c-negative)' : 'var(--text-primary)' }}>
        {amount !== undefined
          ? <Num amount={amount} signed={signed} />
          : <Num pct={pct ?? null} signed={signed} />}
      </p>
    </div>
  )
}

function FilledPieChart({ equity, debt, gold }: { equity: number; debt: number; gold: number }) {
  const cx = 48, cy = 48, r = 44
  const total = equity + debt + gold

  function arcPath(startPct: number, pct: number): string {
    if (pct <= 0) return ''
    const startAngle = (startPct / 100) * 360 - 90
    if (pct >= 99.5) {
      const sx = (cx + r * Math.cos(startAngle * Math.PI / 180)).toFixed(2)
      const sy = (cy + r * Math.sin(startAngle * Math.PI / 180)).toFixed(2)
      const mx = (cx + r * Math.cos((startAngle + 180) * Math.PI / 180)).toFixed(2)
      const my = (cy + r * Math.sin((startAngle + 180) * Math.PI / 180)).toFixed(2)
      return `M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 1 1 ${mx} ${my} A ${r} ${r} 0 1 1 ${sx} ${sy} Z`
    }
    const endAngle = ((startPct + pct) / 100) * 360 - 90
    const sx = (cx + r * Math.cos(startAngle * Math.PI / 180)).toFixed(2)
    const sy = (cy + r * Math.sin(startAngle * Math.PI / 180)).toFixed(2)
    const ex = (cx + r * Math.cos(endAngle   * Math.PI / 180)).toFixed(2)
    const ey = (cy + r * Math.sin(endAngle   * Math.PI / 180)).toFixed(2)
    return `M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 ${pct > 50 ? 1 : 0} 1 ${ex} ${ey} Z`
  }

  function sliceCentroid(startPct: number, pct: number): [number, number] {
    const midAngle = ((startPct + pct / 2) / 100) * 360 - 90
    const rad = midAngle * Math.PI / 180
    const cr = r * 0.58
    return [cx + cr * Math.cos(rad), cy + cr * Math.sin(rad)]
  }

  const LETTERS = ['E', 'D', 'G']
  let offset = 0
  const slices = [
    { pct: equity, color: 'var(--c-equity)', darkLabel: false },
    { pct: debt,   color: 'var(--c-debt)',   darkLabel: false },
    { pct: gold,   color: 'var(--c-gold)',   darkLabel: true  },
  ].map((s, i) => {
    const d        = arcPath(offset, s.pct)
    const centroid = s.pct >= 10 ? sliceCentroid(offset, s.pct) : null
    offset += s.pct
    return { ...s, d, centroid, letter: LETTERS[i], key: i }
  })

  return (
    <div className="flex-shrink-0 flex items-center">
      <svg width="128" height="128" viewBox="0 0 96 96">
        {total === 0
          ? <circle cx={cx} cy={cy} r={r} fill="var(--bg-tertiary)" />
          : slices.map(s => s.d
              ? <path key={s.key} d={s.d} fill={s.color} stroke="var(--bg-primary)" strokeWidth="1.5" />
              : null)
        }
        {total > 0 && slices.map(s => s.centroid && (
          <text
            key={`lbl-${s.key}`}
            x={s.centroid[0].toFixed(2)}
            y={s.centroid[1].toFixed(2)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="9"
            fontWeight="700"
            fill={s.darkLabel ? 'rgba(0,0,0,0.68)' : 'rgba(255,255,255,0.90)'}
            style={{ fontFamily: 'system-ui, -apple-system' }}
          >
            {Math.round(s.pct)}%
          </text>
        ))}
      </svg>
    </div>
  )
}

function SectionHeader({ id, label, invested, gainPct, currentValue, open, onToggle }: {
  id: string; label: string; invested: React.ReactNode
  gainPct: number | null; currentValue: number | null
  open: boolean; onToggle: () => void
}) {
  const positive = gainPct !== null && gainPct >= 0

  return (
    <button onClick={onToggle}
            className="grid w-full items-baseline gap-x-2 px-4"
            style={{ background: 'rgba(255,255,255,0.025)', minHeight: 52, paddingTop: 14, paddingBottom: 14, gridTemplateColumns: SECTION_HEADER_COLS }}>
      <span className="text-headline font-bold truncate text-left" style={{ color: 'var(--text-primary)' }}>{label}</span>
      <span className="text-body tabnum" style={{ color: 'var(--text-2)' }}>{invested}</span>
      <span className="text-headline font-semibold tabnum"
            style={{ color: currentValue !== null ? 'var(--text-2)' : 'var(--text-faint)' }}>
        <Num amount={currentValue} align />
      </span>
      {gainPct !== null ? (
        <span className={`text-body font-bold tabnum ${positive ? 'text-positive' : 'text-negative'}`}>
          <Num pct={gainPct} signed align />
        </span>
      ) : (
        <span />
      )}
      <ChevronRightIcon
        className={`w-4 h-4 transition-transform duration-150 justify-self-end self-center ${open ? 'rotate-90' : ''}`}
        style={{ color: 'var(--text-muted)' }} />
    </button>
  )
}

const SECTION_HEADER_COLS = 'minmax(0,1fr) 58px 78px 62px 1rem'
function PPFRow({ transactions, onSaved, onDeleted }: {
  transactions: PPFTransaction[]
  onSaved: (u: PPFTransaction) => void
  onDeleted: (id: string) => void
}) {
  const rows = [...transactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date))

  if (rows.length === 0) {
    return <EmptyState>No deposits yet.</EmptyState>
  }

  return (
    <>
      {rows.map(t => (
        <TxnRow key={t.id}
          txn={ppfToDisplayTxn(t)}
          showAssetTag={false}
          onDelete={id => onDeleted(id)}
          onSavedStock={() => {}}
          onSavedMF={() => {}}
          onSavedSGB={() => {}}
          onSavedPPF={onSaved}
          onSavedEPF={() => {}}
        />
      ))}
    </>
  )
}

function EPFRow({ transactions, onSaved, onDeleted }: {
  transactions: EPFTransaction[]
  onSaved: (u: EPFTransaction) => void
  onDeleted: (id: string) => void
}) {
  const rows = [...transactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date))

  if (rows.length === 0) {
    return <EmptyState>No transactions yet. Import from passbook.</EmptyState>
  }

  return (
    <>
      {rows.map(t => {
        const isInterest = t.trade_type === 'interest'
        return (
          <TxnRow key={t.id}
            txn={epfToDisplayTxn(t)}
            showAssetTag={false}
            compactLabel={{
              text: isInterest ? `Interest ${fyLabel(t.trade_date)}` : monthYear(t.wage_month ?? t.trade_date),
              faint: formatDate(t.trade_date),
              italic: isInterest,
            }}
            onDelete={id => onDeleted(id)}
            onSavedStock={() => {}}
            onSavedMF={() => {}}
            onSavedSGB={() => {}}
            onSavedPPF={() => {}}
            onSavedEPF={onSaved}
          />
        )
      })}
    </>
  )
}
