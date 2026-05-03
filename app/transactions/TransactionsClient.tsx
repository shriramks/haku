'use client'
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINR, formatINRFine, formatDate, shortMonthYear } from '@/lib/formatter'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import type { Transaction, FiscalYear } from '@/lib/types'
import UserMenu from '@/components/UserMenu'
import { PencilIcon, FilterIcon, ChevronRightIcon, SearchIcon, CheckIcon } from '@/components/icons'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'

// ── Date filter types + helpers ───────────────────────────────────────────────

interface DateFilter {
  label: string
  from: string  // YYYY-MM-DD
  to: string    // YYYY-MM-DD
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

// ── Main component ────────────────────────────────────────────────────────────

export default function TransactionsClient({
  transactions: initial,
  fiscalYears,
  currentFY,
  filterSymbol,
}: {
  transactions: Transaction[]
  fiscalYears: FiscalYear[]
  currentFY: FiscalYear | null
  filterSymbol?: string
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

  // Sheet visibility
  const [filterOpen,     setFilterOpen]     = useState(false)
  const [stockSheetOpen, setStockSheetOpen] = useState(false)
  const [dateSheetOpen,  setDateSheetOpen]  = useState(false)

  const kh = useKeyboardHeight()

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { setTxns(initial) }, [initial])

  function deleteTxn(id: string)     { setTxns(prev => prev.filter(t => t.id !== id)) }
  function updateTxn(u: Transaction) { setTxns(prev => prev.map(t => t.id === u.id ? u : t)) }

  function resetFilters() {
    setTypeFilter('all')
    setSymbolFilter('all')
    setDateFilter(defaultDateFilter)
  }

  const isDefaultDate = dateFilter?.from === defaultDateFilter?.from && dateFilter?.to === defaultDateFilter?.to
  const hasFilters = typeFilter !== 'all' || symbolFilter !== 'all' || !isDefaultDate

  const symbols = useMemo(() =>
    Array.from(new Set(txns.map(t => t.symbol))).sort(), [txns])

  const displayed = useMemo(() => txns
    .filter(t => !filterSymbol || t.symbol === filterSymbol)
    .filter(t => typeFilter === 'all' || t.trade_type === typeFilter)
    .filter(t => symbolFilter === 'all' || t.symbol === symbolFilter)
    .filter(t => !dateFilter || (t.trade_date >= dateFilter.from && t.trade_date <= dateFilter.to)),
    [txns, filterSymbol, typeFilter, symbolFilter, dateFilter]
  )

  const grouped = useMemo(() => groupByMonth(displayed), [displayed])

  // Active dismissible tags
  const activeTags: { key: string; label: string; clear: () => void }[] = []
  if (typeFilter !== 'all')
    activeTags.push({ key: 'type',   label: typeFilter === 'buy' ? 'Buys' : 'Sells', clear: () => setTypeFilter('all') })
  if (!filterSymbol && symbolFilter !== 'all')
    activeTags.push({ key: 'symbol', label: symbolFilter, clear: () => setSymbolFilter('all') })
  if (dateFilter && !isDefaultDate)
    activeTags.push({ key: 'date', label: dateFilter.label, clear: () => setDateFilter(defaultDateFilter) })

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

      {/* Stock picker row */}
      {!filterSymbol && (
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

      {/* Date picker row */}
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

        {/* Filter row */}
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
          {grouped.map(({ month, items, buyTotal, sellTotal }) => (
            <section key={month}>
              <div className="flex items-end justify-between gap-3 px-4 pt-4 pb-3">
                <p className="font-extrabold tracking-tight" style={{ fontSize: 26, letterSpacing: -0.8 }}>{month}</p>
                <div className="flex-shrink-0 pb-0.5" style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 5, rowGap: 1, alignItems: 'baseline' }}>
                  {buyTotal > 0 && (
                    <>
                      <span className="tabnum text-footnote font-semibold text-right text-positive">{formatINR(buyTotal)}</span>
                      <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>bought</span>
                    </>
                  )}
                  {sellTotal > 0 && (
                    <>
                      <span className="tabnum text-footnote font-semibold text-right text-negative">{formatINR(sellTotal)}</span>
                      <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>sold</span>
                    </>
                  )}
                </div>
              </div>
              <div className="divide-y divide-[color:var(--divider)]">
                {items.map(txn => (
                  <TxnRow
                    key={txn.id}
                    txn={txn}
                    fiscalYears={fiscalYears}
                    onDelete={deleteTxn}
                    onSaved={updateTxn}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {filterSheet}
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

  function handleCustomFrom(v: string) { setCustomFrom(v) }
  function handleCustomTo(v: string)   { setCustomTo(v) }

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

      {/* Rolling quick selects */}
      <div className="px-5 pt-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <p className="text-footnote uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
          Recent
        </p>
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

      {/* Fiscal year selects */}
      <div className="px-5 pt-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <p className="text-footnote uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
          Fiscal year
        </p>
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

      {/* Custom range */}
      <div className="px-5 pt-4 pb-2">
        <p className="text-footnote uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
          Custom range
        </p>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={e => handleCustomFrom(e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-xl text-body outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }}
          />
          <span className="text-body flex-shrink-0" style={{ color: 'var(--text-faint)' }}>→</span>
          <input
            type="date"
            value={customTo}
            onChange={e => handleCustomTo(e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-xl text-body outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }}
          />
        </div>
      </div>
    </>
  )
}

// ── TxnRow ────────────────────────────────────────────────────────────────────

function TxnRow({ txn, fiscalYears, onDelete, onSaved }: {
  txn: Transaction
  fiscalYears: FiscalYear[]
  onDelete: (id: string) => void
  onSaved: (updated: Transaction) => void
}) {
  const [editing, setEditing]         = useState(false)
  const [editQty, setEditQty]         = useState('')
  const [editPrice, setEditPrice]     = useState('')
  const [editDate, setEditDate]       = useState('')
  const [advanceOn, setAdvanceOn]     = useState(false)
  const [advanceFyId, setAdvanceFyId] = useState<string | null>(null)
  const [saving, setSaving]           = useState(false)
  const [confirming, setConfirming]   = useState(false)

  const isBuy    = txn.trade_type === 'buy'
  const otherFYs = fiscalYears.filter(f => f.id !== txn.fy_id)

  function openEdit() {
    setEditQty(String(txn.quantity))
    setEditPrice(String(txn.price))
    setEditDate(txn.trade_date)
    setAdvanceOn(!!txn.advance_fy_id)
    setAdvanceFyId(txn.advance_fy_id ?? null)
    setConfirming(false)
    setEditing(true)
  }

  function cancelEdit() { setEditing(false); setConfirming(false) }

  async function save() {
    const qty   = parseFloat(editQty)
    const price = parseFloat(editPrice)
    if (!qty || !price || !editDate) return
    setSaving(true)
    const patch = {
      quantity:      qty,
      price,
      trade_date:    editDate,
      advance_fy_id: advanceOn && advanceFyId ? advanceFyId : null,
    }
    await getSupabaseBrowser().from('transactions').update(patch).eq('id', txn.id)
    onSaved({ ...txn, ...patch, amount: qty * price })
    setSaving(false)
    setEditing(false)
  }

  async function doDelete() {
    await getSupabaseBrowser().from('transactions').delete().eq('id', txn.id)
    onDelete(txn.id)
  }

  const editAmount  = (parseFloat(editQty) || 0) * (parseFloat(editPrice) || 0)
  const saveDisabled = saving || !editQty || !editPrice || !editDate || (advanceOn && !advanceFyId)

  // ── Edit mode ──
  if (editing) {
    return (
      <div className="px-4 py-3" style={{ background: 'rgba(10,132,255,0.04)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isBuy ? 'bg-positive' : 'bg-negative'}`} />
            <span className="font-semibold text-headline">{txn.symbol}</span>
            <span className={`text-footnote font-bold px-1.5 py-0.5 rounded-md ${isBuy ? 'text-positive' : 'text-negative'}`}
                  style={{ background: isBuy ? 'rgba(52,199,89,0.15)' : 'rgba(255,59,48,0.15)' }}>
              {isBuy ? 'BUY' : 'SELL'}
            </span>
          </div>
          <span className="font-bold tabnum text-body" style={{ color: 'var(--text-2)' }}>
            {editAmount > 0 ? formatINR(editAmount) : formatINR(txn.amount)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <p className="text-footnote uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Quantity</p>
            <input type="number" inputMode="numeric" value={editQty} onChange={e => setEditQty(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </div>
          <div>
            <p className="text-footnote uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Price (₹)</p>
            <input type="number" inputMode="decimal" value={editPrice} onChange={e => setEditPrice(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-body tabnum outline-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <p className="text-footnote uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Date</p>
            <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-body outline-none"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark' }} />
          </div>
          <div />
        </div>

        {isBuy && otherFYs.length > 0 && (
          <div className="border-t pt-3 mb-3" style={{ borderColor: 'var(--border-faint)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body font-medium">Count toward a different FY</p>
                <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-muted)' }}>Apply this to another year's plan</p>
              </div>
              <button
                type="button"
                onClick={() => { setAdvanceOn(v => !v); setAdvanceFyId(null) }}
                className={`w-[51px] h-[31px] rounded-full relative flex-shrink-0 transition-colors ${advanceOn ? 'bg-positive' : ''}`}
                style={advanceOn ? undefined : { background: 'var(--border)' }}>
                <span className="absolute top-[2px] w-[27px] h-[27px] rounded-full bg-white transition-all"
                      style={{ left: advanceOn ? '22px' : '2px', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
              </button>
            </div>
            {advanceOn && (
              <div className="mt-3 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                {otherFYs.map(fy => (
                  <button key={fy.id} type="button"
                    onClick={() => setAdvanceFyId(fy.id)}
                    className="w-full flex items-center justify-between px-4 py-3 border-b last:border-b-0 text-left"
                    style={{
                      borderColor: 'var(--border-faint)',
                      background: advanceFyId === fy.id ? 'rgba(10,132,255,0.06)' : 'var(--bg-secondary)',
                    }}>
                    <div>
                      <p className="text-body font-medium"
                         style={{ color: advanceFyId === fy.id ? 'var(--accent)' : 'var(--text-primary)' }}>{fy.label}</p>
                      <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>
                        {shortMonthYear(fy.start_date)} – {shortMonthYear(fy.end_date)}
                      </p>
                    </div>
                    {advanceFyId === fy.id && (
                      <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {confirming ? (
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)}
              className="flex-1 py-2.5 rounded-xl text-body font-medium"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
              Keep
            </button>
            <button onClick={doDelete}
              className="flex-1 py-2.5 rounded-xl text-body font-medium text-negative"
              style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.18)' }}>
              Delete
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <button onClick={() => setConfirming(true)}
              className="px-4 py-2.5 rounded-xl text-body font-medium text-negative"
              style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.2)' }}>
              Delete
            </button>
            <div className="flex gap-2">
              <button onClick={cancelEdit}
                className="px-4 py-2.5 rounded-xl text-body font-medium"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button onClick={save} disabled={saveDisabled}
                className="px-5 py-2.5 rounded-xl text-body font-semibold disabled:opacity-40 text-white bg-accent">
                {saving ? '…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Normal display ──
  return (
    <div className="flex items-center px-4 py-3 gap-3 tap-row">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="font-semibold text-headline flex-shrink-0">{txn.symbol}</span>
          <span className="text-subheadline flex-shrink-0" style={{ color: 'var(--text-muted)' }}>·</span>
          <span className="text-subheadline tabnum flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{formatDate(txn.trade_date)}</span>
          {txn.advance_fy_id && (
            <span className="text-footnote font-semibold px-1.5 py-0.5 rounded-md text-accent flex-shrink-0"
                  style={{ background: 'rgba(10,132,255,0.12)', border: '1px solid rgba(10,132,255,0.25)' }}>
              {`→ ${getFYLabel(txn.advance_fy_id, fiscalYears)}`}
            </span>
          )}
        </div>
        <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {txn.quantity % 1 === 0 ? txn.quantity : txn.quantity.toFixed(1)} shares
          {' · '}{txn.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </p>
        {txn.notes && (
          <p className="text-footnote mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>{txn.notes}</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <p className={`font-bold tabnum text-headline ${isBuy ? 'text-positive' : 'text-negative'}`}>
          {isBuy ? '+' : '−'}{formatINRFine(txn.amount)}
        </p>
        <button onClick={openEdit}
          className="w-[44px] h-[44px] flex items-center justify-center flex-shrink-0"
          style={{ color: 'var(--text-faint)' }}>
          <PencilIcon className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFYLabel(fyId: string, fiscalYears: FiscalYear[]): string {
  return fiscalYears.find(f => f.id === fyId)?.label ?? '?'
}

function groupByMonth(txns: Transaction[]) {
  const map = new Map<string, Transaction[]>()
  for (const t of txns) {
    const key = new Date(t.trade_date + 'T00:00:00')
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  return Array.from(map.entries()).map(([month, items]) => ({
    month,
    items,
    buyTotal:  items.filter(t => t.trade_type === 'buy').reduce((s, t) => s + t.amount, 0),
    sellTotal: items.filter(t => t.trade_type === 'sell').reduce((s, t) => s + t.amount, 0),
  }))
}
