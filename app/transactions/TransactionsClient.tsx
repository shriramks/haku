'use client'
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatDate, formatPriceNum } from '@/lib/formatter'
import { Num } from '@/components/Num'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import type { Transaction, FiscalYear } from '@/lib/types'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, EPFTransaction } from '@/lib/portfolio-types'
import UserMenu from '@/components/UserMenu'
import { PencilIcon, FilterIcon, ChevronRightIcon, SearchIcon, CheckIcon } from '@/components/icons'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'

// ── Asset types ───────────────────────────────────────────────────────────────

type AssetType = 'stock' | 'mf' | 'gold' | 'ppf' | 'epf'

const ASSET_LABELS: Record<AssetType, string> = {
  stock: 'Stocks', mf: 'MF', gold: 'Gold', ppf: 'PPF', epf: 'EPF',
}

function assetFilterLabel(f: Set<AssetType>): string {
  const names = Array.from(f).map(a => ASSET_LABELS[a])
  if (names.length <= 2) return names.join(', ')
  return `${names.length} assets`
}

// ── Unified display type ──────────────────────────────────────────────────────

interface DisplayTxn {
  id: string
  asset: AssetType
  name: string
  trade_date: string
  direction: 'in' | 'out' | 'neutral'
  trade_type: string
  amount: number
  signedAmount: number
  detail: string
  rawStock?: Transaction
}

// ── Date filter types + helpers ───────────────────────────────────────────────

interface DateFilter {
  label: string
  from: string
  to: string
}

function toYMD(d: Date) { return d.toISOString().slice(0, 10) }

const ROLLING_OPTIONS = [
  { key: 'last7',  label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last3m', label: 'Last 3 months' },
]

function getRollingRange(key: string): { from: string; to: string } {
  const today = new Date()
  const ago = (days: number) => { const d = new Date(today); d.setDate(today.getDate() - days); return d }
  const agoMonths = (m: number) => { const d = new Date(today); d.setMonth(today.getMonth() - m); return d }
  if (key === 'last7')  return { from: toYMD(ago(6)),       to: toYMD(today) }
  if (key === 'last30') return { from: toYMD(ago(29)),      to: toYMD(today) }
  if (key === 'last3m') return { from: toYMD(agoMonths(3)), to: toYMD(today) }
  return { from: '', to: '' }
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

function fmtQty(n: number, dec: number): string {
  return n % 1 === 0 ? String(n) : parseFloat(n.toFixed(dec)).toString()
}
function fmtNav(n: number): string {
  return n % 1 === 0 ? String(n) : parseFloat(n.toFixed(2)).toString()
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TransactionsClient({
  transactions: initial,
  fiscalYears,
  currentFY,
  filterSymbol,
  mfFunds,
  mfTransactions,
  sgbTransactions,
  ppfTransactions,
  epfTransactions,
}: {
  transactions: Transaction[]
  fiscalYears: FiscalYear[]
  currentFY: FiscalYear | null
  filterSymbol?: string
  mfFunds: MFund[]
  mfTransactions: MFTransaction[]
  sgbTransactions: SGBTransaction[]
  ppfTransactions: PPFTransaction[]
  epfTransactions: EPFTransaction[]
}) {
  const defaultDateFilter: DateFilter | null = currentFY
    ? { label: currentFY.label, from: currentFY.start_date, to: currentFY.end_date }
    : null

  const [txns, setTxns]       = useState(initial)
  const [mounted, setMounted] = useState(false)

  // Filters
  const [typeFilter,   setTypeFilter]   = useState<'all' | 'buy' | 'sell'>('all')
  const [symbolFilter, setSymbolFilter] = useState('all')
  const [dateFilter,   setDateFilter]   = useState<DateFilter | null>(defaultDateFilter)
  const [assetFilter,  setAssetFilter]  = useState<Set<AssetType>>(new Set())

  // Sheet visibility
  const [filterOpen,     setFilterOpen]     = useState(false)
  const [stockSheetOpen, setStockSheetOpen] = useState(false)
  const [dateSheetOpen,  setDateSheetOpen]  = useState(false)
  const [assetSheetOpen, setAssetSheetOpen] = useState(false)

  const kh = useKeyboardHeight()

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { setTxns(initial) }, [initial])

  // Clear symbol filter when switching away from stocks
  useEffect(() => {
    if (assetFilter.size > 0 && !assetFilter.has('stock')) setSymbolFilter('all')
  }, [assetFilter])

  function deleteTxn(id: string)     { setTxns(prev => prev.filter(t => t.id !== id)) }
  function updateTxn(u: Transaction) { setTxns(prev => prev.map(t => t.id === u.id ? u : t)) }

  function resetFilters() {
    setTypeFilter('all')
    setSymbolFilter('all')
    setDateFilter(defaultDateFilter)
    setAssetFilter(new Set())
  }

  // ── Normalise all transaction types into one list ──
  const allDisplayTxns = useMemo((): DisplayTxn[] => {
    const fundMap = new Map(mfFunds.map(f => [f.id, f]))

    const stocks: DisplayTxn[] = txns.map(t => ({
      id:           t.id,
      asset:        'stock',
      name:         t.symbol,
      trade_date:   t.trade_date,
      direction:    t.trade_type === 'buy' ? 'in' : 'out',
      trade_type:   t.trade_type,
      amount:       t.amount,
      signedAmount: t.trade_type === 'buy' ? t.amount : -t.amount,
      detail:       `${fmtQty(t.quantity, 1)} sh · ${formatPriceNum(t.price)}`,
      rawStock:     t,
    }))

    const mfs: DisplayTxn[] = mfTransactions.map(t => ({
      id:           t.id,
      asset:        'mf',
      name:         fundMap.get(t.fund_id)?.scheme_name ?? 'Unknown Fund',
      trade_date:   t.trade_date,
      direction:    t.trade_type === 'buy' ? 'in' : 'out',
      trade_type:   t.trade_type,
      amount:       t.amount,
      signedAmount: t.trade_type === 'buy' ? t.amount : -t.amount,
      detail:       `${fmtQty(t.units, 3)} units · NAV ${fmtNav(t.nav)}`,
    }))

    const gold: DisplayTxn[] = sgbTransactions.map(t => ({
      id:           t.id,
      asset:        'gold',
      name:         t.gold_type === 'sgb'
                      ? `Gold SGB${t.name ? ' · ' + t.name : ''}`
                      : (t.name ?? (t.gold_type === 'etf' ? 'Gold ETF' : 'Physical Gold')),
      trade_date:   t.trade_date,
      direction:    t.trade_type === 'buy' ? 'in' : 'out',
      trade_type:   t.trade_type,
      amount:       t.amount,
      signedAmount: t.trade_type === 'buy' ? t.amount : -t.amount,
      detail:       `${fmtQty(t.grams, 3)}g · ${formatPriceNum(t.price_per_gram)}/g`,
    }))

    const ppf: DisplayTxn[] = ppfTransactions.map(t => ({
      id:           t.id,
      asset:        'ppf',
      name:         'PPF',
      trade_date:   t.trade_date,
      direction:    t.trade_type === 'deposit' ? 'in' : t.trade_type === 'withdrawal' ? 'out' : 'neutral',
      trade_type:   t.trade_type,
      amount:       t.amount,
      signedAmount: t.trade_type === 'deposit' ? t.amount : t.trade_type === 'withdrawal' ? -t.amount : t.amount,
      detail:       capitalize(t.trade_type),
    }))

    const epf: DisplayTxn[] = epfTransactions.map(t => ({
      id:           t.id,
      asset:        'epf',
      name:         'EPF',
      trade_date:   t.trade_date,
      direction:    t.trade_type === 'deposit' ? 'in' : 'neutral',
      trade_type:   t.trade_type,
      amount:       t.amount,
      signedAmount: t.amount,
      detail:       capitalize(t.trade_type),
    }))

    return [...stocks, ...mfs, ...gold, ...ppf, ...epf]
      .sort((a, b) => b.trade_date.localeCompare(a.trade_date))
  }, [txns, mfFunds, mfTransactions, sgbTransactions, ppfTransactions, epfTransactions])

  // ── Stock symbols for the symbol picker ──
  const symbols = useMemo(() =>
    Array.from(new Set(txns.map(t => t.symbol))).sort(), [txns])

  // ── Apply filters ──
  const isDefaultDate = dateFilter?.from === defaultDateFilter?.from && dateFilter?.to === defaultDateFilter?.to
  const hasFilters = typeFilter !== 'all' || symbolFilter !== 'all' || !isDefaultDate || assetFilter.size > 0

  const displayed = useMemo(() => allDisplayTxns
    .filter(t => !filterSymbol || (t.asset === 'stock' && t.name === filterSymbol))
    .filter(t => assetFilter.size === 0 || assetFilter.has(t.asset))
    .filter(t => typeFilter === 'all' || (typeFilter === 'buy' ? t.direction === 'in' : t.direction === 'out'))
    .filter(t => symbolFilter === 'all' || (t.asset === 'stock' && t.name === symbolFilter))
    .filter(t => !dateFilter || (t.trade_date >= dateFilter.from && t.trade_date <= dateFilter.to)),
    [allDisplayTxns, filterSymbol, assetFilter, typeFilter, symbolFilter, dateFilter]
  )

  const grouped = useMemo(() => groupByMonth(displayed), [displayed])

  // Show asset tag in rows only when multiple asset types are visible
  const showAssetTag = assetFilter.size !== 1 && !filterSymbol

  // ── Dismissible filter tags ──
  const activeTags: { key: string; label: string; clear: () => void }[] = []
  if (assetFilter.size > 0)
    activeTags.push({ key: 'asset',  label: assetFilterLabel(assetFilter),                 clear: () => setAssetFilter(new Set()) })
  if (typeFilter !== 'all')
    activeTags.push({ key: 'type',   label: typeFilter === 'buy' ? 'Buys' : 'Sells',       clear: () => setTypeFilter('all') })
  if (!filterSymbol && symbolFilter !== 'all')
    activeTags.push({ key: 'symbol', label: symbolFilter,                                   clear: () => setSymbolFilter('all') })
  if (dateFilter && !isDefaultDate)
    activeTags.push({ key: 'date',   label: dateFilter.label,                               clear: () => setDateFilter(defaultDateFilter) })

  // ── Filter sheet ──
  const filterSheet = filterOpen && mounted && createPortal(
    <BottomSheet onClose={() => setFilterOpen(false)}>
      <SheetHeader
        title="Filter"
        left={
          <button
            onClick={resetFilters}
            className="text-headline"
            style={{ color: hasFilters ? '#FF3B30' : 'var(--text-muted)' }}
            disabled={!hasFilters}>
            Reset
          </button>
        }
        right={
          <button onClick={() => setFilterOpen(false)} className="font-semibold text-headline text-accent">
            Done
          </button>
        }
      />

      {/* Asset */}
      <button
        onClick={() => setAssetSheetOpen(true)}
        className="w-full flex items-center justify-between px-5 border-b"
        style={{ minHeight: 52, borderColor: 'var(--border-faint)' }}>
        <span className="text-body">Asset</span>
        <span className="flex items-center gap-1.5 text-body"
              style={{ color: assetFilter.size === 0 ? 'var(--text-muted)' : 'var(--accent)' }}>
          {assetFilter.size === 0 ? 'Any' : assetFilterLabel(assetFilter)}
          <ChevronRightIcon className="w-4 h-4 opacity-40" />
        </span>
      </button>

      {/* Type */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <p className="text-footnote uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Type</p>
        <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {(['all', 'buy', 'sell'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className="flex-1 py-2.5 text-body font-medium transition-colors"
              style={typeFilter === t
                ? { background: 'var(--accent)', color: '#fff' }
                : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
              {t === 'all' ? 'All' : t === 'buy' ? 'Buys' : 'Sells'}
            </button>
          ))}
        </div>
      </div>

      {/* Stock picker — only when stocks are in view */}
      {!filterSymbol && (assetFilter.size === 0 || assetFilter.has('stock')) && (
        <button
          onClick={() => setStockSheetOpen(true)}
          className="w-full flex items-center justify-between px-5 border-b"
          style={{ minHeight: 52, borderColor: 'var(--border-faint)' }}>
          <span className="text-body">Stock</span>
          <span className="flex items-center gap-1.5 text-body"
                style={{ color: symbolFilter === 'all' ? 'var(--text-muted)' : 'var(--accent)' }}>
            {symbolFilter === 'all' ? 'Any' : symbolFilter}
            <ChevronRightIcon className="w-4 h-4 opacity-40" />
          </span>
        </button>
      )}

      {/* Date */}
      <button
        onClick={() => setDateSheetOpen(true)}
        className="w-full flex items-center justify-between px-5 border-b"
        style={{ minHeight: 52, borderColor: 'var(--border-faint)' }}>
        <span className="text-body">Date</span>
        <span className="flex items-center gap-1.5 text-body"
              style={{ color: dateFilter ? 'var(--accent)' : 'var(--text-muted)' }}>
          {dateFilter?.label ?? 'Any time'}
          <ChevronRightIcon className="w-4 h-4 opacity-40" />
        </span>
      </button>
    </BottomSheet>,
    document.body
  )

  // ── Asset sub-sheet ──
  const assetSheet = assetSheetOpen && mounted && createPortal(
    <>
      <div className="fixed inset-0 z-[210]" onClick={() => setAssetSheetOpen(false)} />
      <div className="fixed left-0 right-0 z-[210] rounded-t-[28px] sheet-kb"
           style={{ bottom: kh, background: 'var(--bg-secondary)', paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
        <AssetSubSheet
          value={assetFilter}
          onApply={v => { setAssetFilter(v); setAssetSheetOpen(false) }}
          onClose={() => setAssetSheetOpen(false)}
        />
      </div>
    </>,
    document.body
  )

  // ── Stock sub-sheet ──
  const stockSheet = stockSheetOpen && mounted && createPortal(
    <>
      <div className="fixed inset-0 z-[210]" onClick={() => setStockSheetOpen(false)} />
      <div className="fixed left-0 right-0 z-[210] rounded-t-[28px] sheet-kb"
           style={{ bottom: kh, background: 'var(--bg-secondary)', paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
        <StockSubSheet
          symbols={symbols}
          value={symbolFilter}
          onSelect={s => { setSymbolFilter(s); setStockSheetOpen(false) }}
          onClose={() => setStockSheetOpen(false)}
        />
      </div>
    </>,
    document.body
  )

  // ── Date sub-sheet ──
  const dateSheet = dateSheetOpen && mounted && createPortal(
    <>
      <div className="fixed inset-0 z-[210]" onClick={() => setDateSheetOpen(false)} />
      <div className="fixed left-0 right-0 z-[210] rounded-t-[28px] sheet-kb"
           style={{ bottom: kh, background: 'var(--bg-secondary)', paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
        <DateSubSheet
          value={dateFilter}
          fiscalYears={fiscalYears}
          onApply={f => { setDateFilter(f); setDateSheetOpen(false) }}
          onClose={() => setDateSheetOpen(false)}
        />
      </div>
    </>,
    document.body
  )

  return (
    <div style={{ minHeight: '100dvh' }}>
      {/* ── Sticky header ── */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between px-4 pt-1">
          <div>
            <h1 className="text-display font-bold">{filterSymbol ?? 'Transactions'}</h1>
            {filterSymbol && (
              <a href="/transactions" className="text-subheadline text-accent">← All</a>
            )}
          </div>
          <UserMenu />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 px-4 pt-2 pb-3 overflow-x-auto"
             style={{ scrollbarWidth: 'none' }}>
          <a
            href="/import"
            className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0 text-subheadline font-medium"
            style={{ background: 'rgba(10,132,255,0.12)', color: 'var(--accent)', border: '1px solid rgba(10,132,255,0.25)', textDecoration: 'none' }}>
            <ImportIcon className="w-3.5 h-3.5" />
            Import
          </a>

          <button
            onClick={() => setFilterOpen(true)}
            className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0 text-subheadline font-medium"
            style={hasFilters
              ? { background: 'rgba(10,132,255,0.12)', color: 'var(--accent)', border: '1px solid rgba(10,132,255,0.25)' }
              : { background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
            <FilterIcon className="w-3.5 h-3.5" />
            Filter
          </button>

          {activeTags.length > 0 && (
            <div className="w-px self-stretch my-1.5 flex-shrink-0" style={{ background: 'var(--border)' }} />
          )}

          {activeTags.map(tag => (
            <div key={tag.key}
              className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0 text-subheadline font-medium"
              style={{ background: 'rgba(10,132,255,0.12)', color: 'var(--accent)', border: '1px solid rgba(10,132,255,0.25)' }}>
              {tag.label}
              <button
                onClick={tag.clear}
                className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold leading-none"
                style={{ background: 'rgba(10,132,255,0.2)', color: 'var(--accent)' }}>
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Txn list ── */}
      {displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center px-6"
             style={{
               color: 'var(--text-muted)',
               minHeight: 'calc(100dvh - var(--nav-h, 64px) - var(--safe-bottom, 0px) - 100px)',
             }}>
          <svg className="w-12 h-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-headline font-medium">
            {hasFilters ? 'No matching transactions' : 'No transactions yet'}
          </p>
          <p className="text-body">
            {hasFilters ? 'Try adjusting your filters' : 'Tap + to log your first trade'}
          </p>
        </div>
      ) : (
        <div className="pt-1 space-y-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
          {grouped.map(({ month, items, investedTotal, withdrawnTotal }) => (
            <section key={month}>
              <div className="flex items-end justify-between gap-3 px-4 pt-4 pb-3">
                <p className="font-extrabold tracking-tight" style={{ fontSize: 26, letterSpacing: -0.8 }}>{month}</p>
                <div className="flex-shrink-0 pb-0.5" style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 5, rowGap: 1, alignItems: 'baseline' }}>
                  {investedTotal > 0 && (
                    <>
                      <span className="tabnum text-footnote font-semibold text-right text-positive"><Num amount={investedTotal} /></span>
                      <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>invested</span>
                    </>
                  )}
                  {withdrawnTotal > 0 && (
                    <>
                      <span className="tabnum text-footnote font-semibold text-right text-negative"><Num amount={withdrawnTotal} /></span>
                      <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>withdrawn</span>
                    </>
                  )}
                </div>
              </div>
              <div>
                {items.map(txn => (
                  <TxnRow
                    key={txn.id}
                    txn={txn}
                    showAssetTag={showAssetTag}
                    onDelete={deleteTxn}
                    onSavedStock={updateTxn}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {filterSheet}
      {assetSheet}
      {stockSheet}
      {dateSheet}
    </div>
  )
}

function ImportIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0l-4-4m4 4l4-4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
    </svg>
  )
}

// ── AssetSubSheet ─────────────────────────────────────────────────────────────

const ASSET_OPTIONS: { key: AssetType; label: string }[] = [
  { key: 'stock', label: 'Stocks' },
  { key: 'mf',    label: 'Mutual Funds' },
  { key: 'gold',  label: 'Gold' },
  { key: 'ppf',   label: 'PPF' },
  { key: 'epf',   label: 'EPF' },
]

function AssetSubSheet({ value, onApply, onClose }: {
  value: Set<AssetType>
  onApply: (v: Set<AssetType>) => void
  onClose: () => void
}) {
  const [local, setLocal] = useState(new Set(value))
  const allSelected = local.size === 0

  function toggle(a: AssetType) {
    setLocal(prev => {
      const next = new Set(prev)
      if (next.has(a)) next.delete(a)
      else next.add(a)
      return next
    })
  }

  return (
    <>
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
      </div>
      <SheetHeader
        title="Asset"
        left={null}
        right={<button onClick={() => onApply(local)} className="font-semibold text-headline text-accent">Done</button>}
      />
      <div style={{ overflowY: 'auto', maxHeight: '50vh' }}>
        <button
          onClick={() => setLocal(new Set())}
          className="w-full flex items-center justify-between px-5 border-b"
          style={{
            minHeight: 52, borderColor: 'var(--border-faint)',
            background: allSelected ? 'rgba(10,132,255,0.04)' : undefined,
          }}>
          <span className="text-body"
                style={{ color: allSelected ? 'var(--accent)' : 'var(--text-primary)', fontWeight: allSelected ? 500 : 400 }}>
            All assets
          </span>
          {allSelected && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' } as React.CSSProperties} />}
        </button>
        {ASSET_OPTIONS.map(({ key, label }) => {
          const sel = local.has(key)
          return (
            <button key={key}
              onClick={() => toggle(key)}
              className="w-full flex items-center justify-between px-5 border-b last:border-b-0"
              style={{
                minHeight: 52, borderColor: 'var(--border-faint)',
                background: sel ? 'rgba(10,132,255,0.04)' : undefined,
              }}>
              <span className="text-body"
                    style={{ color: sel ? 'var(--accent)' : 'var(--text-primary)', fontWeight: sel ? 500 : 400 }}>
                {label}
              </span>
              {sel && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' } as React.CSSProperties} />}
            </button>
          )
        })}
      </div>
    </>
  )
}

// ── StockSubSheet ─────────────────────────────────────────────────────────────

function StockSubSheet({ symbols, value, onSelect, onClose }: {
  symbols: string[]
  value: string
  onSelect: (s: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const filtered = symbols.filter(s => s.toLowerCase().includes(search.toLowerCase()))

  return (
    <>
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
      </div>
      <SheetHeader
        title="Stock"
        left={null}
        right={<button onClick={onClose} className="font-semibold text-headline text-accent">Done</button>}
      />
      <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
             style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
          <SearchIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' } as React.CSSProperties} />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
            className="flex-1 outline-none text-body bg-transparent"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
      </div>
      <div style={{ maxHeight: '40vh', overflowY: 'auto' }}>
        <button
          onClick={() => onSelect('all')}
          className="w-full flex items-center justify-between px-5 border-b"
          style={{
            minHeight: 52, borderColor: 'var(--border-faint)',
            background: value === 'all' ? 'rgba(10,132,255,0.04)' : undefined,
          }}>
          <span className="text-body"
                style={{ color: value === 'all' ? 'var(--accent)' : 'var(--text-primary)', fontWeight: value === 'all' ? 500 : 400 }}>
            Any stock
          </span>
          {value === 'all' && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' } as React.CSSProperties} />}
        </button>
        {filtered.map(s => (
          <button key={s}
            onClick={() => onSelect(s)}
            className="w-full flex items-center justify-between px-5 border-b last:border-b-0"
            style={{
              minHeight: 52, borderColor: 'var(--border-faint)',
              background: value === s ? 'rgba(10,132,255,0.04)' : undefined,
            }}>
            <span className="text-body"
                  style={{ color: value === s ? 'var(--accent)' : 'var(--text-primary)', fontWeight: value === s ? 500 : 400 }}>
              {s}
            </span>
            {value === s && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' } as React.CSSProperties} />}
          </button>
        ))}
      </div>
    </>
  )
}

// ── DateSubSheet ──────────────────────────────────────────────────────────────

function DateSubSheet({ value, fiscalYears, onApply, onClose }: {
  value: DateFilter | null
  fiscalYears: FiscalYear[]
  onApply: (f: DateFilter | null) => void
  onClose: () => void
}) {
  const [customFrom, setCustomFrom] = useState(value?.from ?? '')
  const [customTo,   setCustomTo]   = useState(value?.to   ?? '')

  function isSelected(from: string, to: string) {
    return customFrom === from && customTo === to
  }

  function selectPreset(from: string, to: string) {
    setCustomFrom(from)
    setCustomTo(to)
  }

  function apply() {
    if (!customFrom || !customTo) { onApply(null); return }
    const rolling = ROLLING_OPTIONS.find(o => {
      const r = getRollingRange(o.key)
      return r.from === customFrom && r.to === customTo
    })
    if (rolling) { onApply({ label: rolling.label, from: customFrom, to: customTo }); return }
    const fy = fiscalYears.find(f => f.start_date === customFrom && f.end_date === customTo)
    if (fy) { onApply({ label: fy.label, from: customFrom, to: customTo }); return }
    const fmt = (d: string) =>
      new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
    onApply({ label: `${fmt(customFrom)} – ${fmt(customTo)}`, from: customFrom, to: customTo })
  }

  return (
    <>
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
      </div>
      <SheetHeader
        title="Date"
        left={
          <button
            onClick={() => onApply(null)}
            className="text-headline"
            style={{ color: value ? '#FF3B30' : 'var(--text-muted)' }}
            disabled={!value}>
            Clear
          </button>
        }
        right={<button onClick={apply} className="font-semibold text-headline text-accent">Done</button>}
      />

      <div className="px-5 pt-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <p className="text-footnote uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Recent</p>
        {ROLLING_OPTIONS.map(opt => {
          const range = getRollingRange(opt.key)
          const sel = isSelected(range.from, range.to)
          return (
            <button key={opt.key}
              onClick={() => selectPreset(range.from, range.to)}
              className="w-full flex items-center justify-between py-3.5 border-b last:border-b-0"
              style={{ borderColor: 'var(--border-faint)' }}>
              <span className="text-body" style={{ color: sel ? 'var(--accent)' : 'var(--text-primary)', fontWeight: sel ? 500 : 400 }}>
                {opt.label}
              </span>
              {sel && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' } as React.CSSProperties} />}
            </button>
          )
        })}
      </div>

      <div className="px-5 pt-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <p className="text-footnote uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Fiscal year</p>
        {[...fiscalYears].reverse().map(fy => {
          const sel = isSelected(fy.start_date, fy.end_date)
          return (
            <button key={fy.id}
              onClick={() => selectPreset(fy.start_date, fy.end_date)}
              className="w-full flex items-center justify-between py-3.5 border-b last:border-b-0"
              style={{ borderColor: 'var(--border-faint)' }}>
              <span className="text-body" style={{ color: sel ? 'var(--accent)' : 'var(--text-primary)', fontWeight: sel ? 500 : 400 }}>
                {fy.label}
              </span>
              {sel && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' } as React.CSSProperties} />}
            </button>
          )
        })}
      </div>

      <div className="px-5 pt-4 pb-2">
        <p className="text-footnote uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Custom range</p>
        <div className="flex items-center gap-2">
          <input
            type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-xl text-body outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }}
          />
          <span className="text-body flex-shrink-0" style={{ color: 'var(--text-faint)' }}>→</span>
          <input
            type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-xl text-body outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }}
          />
        </div>
      </div>
    </>
  )
}

// ── TxnRow helpers ────────────────────────────────────────────────────────────

interface EditState {
  qty: string
  price: string
  date: string
  saving: boolean
  confirming: boolean
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-footnote uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {children}
    </div>
  )
}

function EditActions({ confirming, saveDisabled, saving, onStartDelete, onKeep, onDelete, onCancel, onSave }: {
  confirming: boolean
  saveDisabled: boolean
  saving: boolean
  onStartDelete: () => void
  onKeep: () => void
  onDelete: () => void
  onCancel: () => void
  onSave: () => void
}) {
  if (confirming) {
    return (
      <div className="flex gap-2">
        <button onClick={onKeep}
          className="flex-1 py-2.5 rounded-xl text-body font-medium"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
          Keep
        </button>
        <button onClick={onDelete}
          className="flex-1 py-2.5 rounded-xl text-body font-medium text-negative"
          style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.18)' }}>
          Delete
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between">
      <button onClick={onStartDelete}
        className="px-4 py-2.5 rounded-xl text-body font-medium text-negative"
        style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)' }}>
        Delete
      </button>
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="px-4 py-2.5 rounded-xl text-body font-medium"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
          Cancel
        </button>
        <button onClick={onSave} disabled={saveDisabled}
          className="px-5 py-2.5 rounded-xl text-body font-semibold disabled:opacity-40 text-white bg-accent">
          {saving ? '…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── TxnRow ────────────────────────────────────────────────────────────────────

function TxnRow({ txn, showAssetTag, onDelete, onSavedStock }: {
  txn: DisplayTxn
  showAssetTag: boolean
  onDelete: (id: string) => void
  onSavedStock: (updated: Transaction) => void
}) {
  const [editState, setEditState] = useState<EditState | null>(null)

  const stock = txn.rawStock
  const isBuy = stock?.trade_type === 'buy'

  function openEdit() {
    if (!stock) return
    setEditState({ qty: String(stock.quantity), price: String(stock.price), date: stock.trade_date, saving: false, confirming: false })
  }

  function cancelEdit() { setEditState(null) }

  async function save() {
    if (!stock || !editState) return
    const qty   = parseFloat(editState.qty)
    const price = parseFloat(editState.price)
    if (!qty || !price || !editState.date) return
    setEditState(prev => prev ? { ...prev, saving: true } : null)
    const patch = { quantity: qty, price, trade_date: editState.date }
    await getSupabaseBrowser().from('transactions').update(patch).eq('id', txn.id)
    onSavedStock({ ...stock, ...patch, amount: qty * price })
    setEditState(null)
  }

  async function doDelete() {
    await getSupabaseBrowser().from('transactions').delete().eq('id', txn.id)
    onDelete(txn.id)
  }

  const editAmount       = editState ? (parseFloat(editState.qty) || 0) * (parseFloat(editState.price) || 0) : 0
  const signedEditAmount = isBuy ? editAmount : -editAmount
  const saveDisabled     = !editState || editState.saving || !editState.qty || !editState.price || !editState.date

  // ── Edit mode (stocks only) ──
  if (editState && stock) {
    return (
      <div className="px-4 py-3" style={{ background: 'rgba(10,132,255,0.04)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isBuy ? 'bg-positive' : 'bg-negative'}`} />
            <span className="font-semibold text-headline">{txn.name}</span>
            <span className={`text-footnote font-bold px-1.5 py-0.5 rounded-md ${isBuy ? 'text-positive' : 'text-negative'}`}
                  style={{ background: isBuy ? 'rgba(52,199,89,0.15)' : 'rgba(255,59,48,0.15)' }}>
              {isBuy ? 'BUY' : 'SELL'}
            </span>
          </div>
          <span className="font-bold tabnum text-body" style={{ color: 'var(--text-2)' }}>
            <Num amount={signedEditAmount || txn.signedAmount} signed />
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <EditField label="Quantity">
            <input type="number" inputMode="numeric" value={editState.qty}
              onChange={e => setEditState(prev => prev ? { ...prev, qty: e.target.value } : null)}
              className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </EditField>
          <EditField label="Price">
            <input type="number" inputMode="decimal" value={editState.price}
              onChange={e => setEditState(prev => prev ? { ...prev, price: e.target.value } : null)}
              className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </EditField>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <EditField label="Date">
            <input type="date" value={editState.date}
              onChange={e => setEditState(prev => prev ? { ...prev, date: e.target.value } : null)}
              className="w-full px-3 py-2.5 rounded-xl text-body outline-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }} />
          </EditField>
          <div />
        </div>

        <EditActions
          confirming={editState.confirming}
          saveDisabled={saveDisabled}
          saving={editState.saving}
          onStartDelete={() => setEditState(prev => prev ? { ...prev, confirming: true } : null)}
          onKeep={() => setEditState(prev => prev ? { ...prev, confirming: false } : null)}
          onDelete={doDelete}
          onCancel={cancelEdit}
          onSave={save}
        />
      </div>
    )
  }

  // ── Normal display ──
  const amtColour = txn.direction === 'in' ? 'text-positive' : txn.direction === 'out' ? 'text-negative' : ''
  const amtStyle  = txn.direction === 'neutral' ? { color: 'var(--text-2)' } : undefined

  return (
    <div className="flex items-center px-4 py-3 gap-3 tap-row">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className={`font-semibold truncate ${txn.asset === 'mf' ? 'text-body' : 'text-headline'}`}>
            {txn.name}
          </span>
          <span className="flex-shrink-0 text-subheadline" style={{ color: 'var(--text-muted)' }}>·</span>
          <span className="flex-shrink-0 text-subheadline tabnum" style={{ color: 'var(--text-muted)' }}>
            {formatDate(txn.trade_date)}
          </span>
        </div>
        <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {showAssetTag && (
            <>
              <span className="font-semibold uppercase inline-flex items-center rounded px-1 leading-[1.5]"
                    style={{ fontSize: 10, letterSpacing: '0.04em', color: 'var(--text-muted)', background: 'var(--border-faint)', border: '1px solid var(--border)' }}>
                {ASSET_LABELS[txn.asset]}
              </span>
              <span style={{ color: 'var(--text-faint)' }}>·</span>
            </>
          )}
          {txn.detail}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <p className={`font-bold tabnum text-headline ${amtColour}`} style={amtStyle}>
          <Num amount={txn.signedAmount} signed={txn.direction !== 'neutral'} />
        </p>
        {stock ? (
          <button onClick={openEdit}
            className="w-[44px] h-[44px] flex items-center justify-center flex-shrink-0"
            style={{ color: 'var(--text-faint)' }}>
            <PencilIcon className="w-[18px] h-[18px]" />
          </button>
        ) : (
          <div className="w-[44px] h-[44px] flex-shrink-0" />
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByMonth(txns: DisplayTxn[]) {
  const map = new Map<string, DisplayTxn[]>()
  for (const t of txns) {
    const key = new Date(t.trade_date + 'T00:00:00')
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  return Array.from(map.entries()).map(([month, items]) => ({
    month,
    items,
    investedTotal:  items.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0),
    withdrawnTotal: items.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0),
  }))
}
