'use client'
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINR, formatDate, shortMonthYear } from '@/lib/formatter'
import type { Transaction, FiscalYear } from '@/lib/types'
import UserMenu from '@/components/UserMenu'
import FYPicker from '@/components/FYPicker'
import { getStockName } from '@/lib/stock-names'
import { PencilIcon, FilterIcon, ChevronRightIcon, SearchIcon, CheckIcon } from '@/components/icons'

// ── Date filter types + helpers ───────────────────────────────────────────────

interface DateFilter {
  label: string
  from: string  // YYYY-MM-DD
  to: string    // YYYY-MM-DD
}

function toYMD(d: Date) { return d.toISOString().slice(0, 10) }

const QUICK_OPTIONS = [
  { key: 'last7',  label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last3m', label: 'Last 3 months' },
  { key: 'thisfy', label: 'This FY' },
]

function getQuickRange(key: string, fy: FiscalYear | null): { from: string; to: string } {
  const today = new Date()
  const ago = (days: number) => { const d = new Date(today); d.setDate(today.getDate() - days); return d }
  const agoMonths = (m: number) => { const d = new Date(today); d.setMonth(today.getMonth() - m); return d }
  if (key === 'last7')  return { from: toYMD(ago(6)),        to: toYMD(today) }
  if (key === 'last30') return { from: toYMD(ago(29)),       to: toYMD(today) }
  if (key === 'last3m') return { from: toYMD(agoMonths(3)), to: toYMD(today) }
  if (key === 'thisfy' && fy) return { from: fy.start_date, to: fy.end_date }
  return { from: '', to: '' }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TransactionsClient({
  transactions: initial,
  fiscalYears,
  selectedFY,
  filterSymbol,
}: {
  transactions: Transaction[]
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
  filterSymbol?: string
}) {
  const router = useRouter()
  const [txns, setTxns]       = useState(initial)
  const [mounted, setMounted] = useState(false)

  // Filters
  const [typeFilter,   setTypeFilter]   = useState<'all' | 'buy' | 'sell'>('all')
  const [symbolFilter, setSymbolFilter] = useState('all')
  const [dateFilter,   setDateFilter]   = useState<DateFilter | null>(null)
  const [notesFilter,  setNotesFilter]  = useState('')

  // Sheet visibility
  const [filterOpen,     setFilterOpen]     = useState(false)
  const [stockSheetOpen, setStockSheetOpen] = useState(false)
  const [dateSheetOpen,  setDateSheetOpen]  = useState(false)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { setTxns(initial) }, [initial])

  function deleteTxn(id: string)      { setTxns(prev => prev.filter(t => t.id !== id)) }
  function updateTxn(u: Transaction)  { setTxns(prev => prev.map(t => t.id === u.id ? u : t)) }

  function resetFilters() {
    setTypeFilter('all')
    setSymbolFilter('all')
    setDateFilter(null)
    setNotesFilter('')
  }

  const hasFilters = typeFilter !== 'all' || symbolFilter !== 'all' || !!dateFilter || !!notesFilter

  const symbols = useMemo(() =>
    Array.from(new Set(txns.map(t => t.symbol))).sort(), [txns])

  const displayed = useMemo(() => txns
    .filter(t => !filterSymbol || t.symbol === filterSymbol)
    .filter(t => typeFilter === 'all' || t.trade_type === typeFilter)
    .filter(t => symbolFilter === 'all' || t.symbol === symbolFilter)
    .filter(t => !dateFilter || (t.trade_date >= dateFilter.from && t.trade_date <= dateFilter.to))
    .filter(t => !notesFilter || t.notes.toLowerCase().includes(notesFilter.toLowerCase())),
    [txns, filterSymbol, typeFilter, symbolFilter, dateFilter, notesFilter]
  )

  const grouped = groupByMonth(displayed)

  // Active dismissible tags
  const activeTags: { key: string; label: string; clear: () => void }[] = []
  if (typeFilter !== 'all')
    activeTags.push({ key: 'type',   label: typeFilter === 'buy' ? 'Buys' : 'Sells', clear: () => setTypeFilter('all') })
  if (!filterSymbol && symbolFilter !== 'all')
    activeTags.push({ key: 'symbol', label: symbolFilter,  clear: () => setSymbolFilter('all') })
  if (dateFilter)
    activeTags.push({ key: 'date',   label: dateFilter.label, clear: () => setDateFilter(null) })
  if (notesFilter)
    activeTags.push({ key: 'notes',  label: `"${notesFilter}"`, clear: () => setNotesFilter('') })

  // ── Filter sheet ──
  const filterSheet = filterOpen && mounted && createPortal(
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
           onClick={() => setFilterOpen(false)} />
      <div className="fixed bottom-0 left-0 right-0 z-[200] rounded-t-[28px]"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={resetFilters}
            className="text-headline"
            style={{ color: hasFilters ? '#FF3B30' : 'var(--text-muted)', width: 60 }}
            disabled={!hasFilters}>
            Reset
          </button>
          <p className="font-semibold text-headline">Filter</p>
          <button onClick={() => setFilterOpen(false)}
            className="font-semibold text-headline text-accent"
            style={{ width: 60, textAlign: 'right' }}>
            Done
          </button>
        </div>

        {/* Type */}
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <p className="text-footnote uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Type</p>
          <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
            {(['all', 'buy', 'sell'] as const).map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className="flex-1 py-2.5 text-body font-medium transition-colors"
                style={typeFilter === t
                  ? { background: '#0A84FF', color: '#fff' }
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
                  style={{ color: symbolFilter === 'all' ? 'var(--text-muted)' : '#0A84FF' }}>
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
                style={{ color: dateFilter ? '#0A84FF' : 'var(--text-muted)' }}>
            {dateFilter?.label ?? 'Any time'}
            <ChevronRightIcon className="w-4 h-4 opacity-40" />
          </span>
        </button>

        {/* Notes */}
        <div className="px-5 pt-4">
          <p className="text-footnote uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Notes</p>
          <input
            type="text"
            placeholder="Search notes…"
            value={notesFilter}
            onChange={e => setNotesFilter(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-body outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
        </div>
      </div>
    </>,
    document.body
  )

  // ── Stock sub-sheet ──
  const stockSheet = stockSheetOpen && mounted && createPortal(
    <>
      <div className="fixed inset-0 z-[210]" onClick={() => setStockSheetOpen(false)} />
      <div className="fixed bottom-0 left-0 right-0 z-[210] rounded-t-[28px]"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
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
      <div className="fixed bottom-0 left-0 right-0 z-[210] rounded-t-[28px]"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
        <DateSubSheet
          value={dateFilter}
          selectedFY={selectedFY}
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
          <div className="flex items-center gap-2">
            <FYPicker
              fiscalYears={fiscalYears}
              selectedFY={selectedFY}
              onSelect={fy => router.push(`/transactions?fy=${encodeURIComponent(fy.label)}`)}
            />
            <UserMenu />
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-2 px-4 pt-2 pb-3 overflow-x-auto"
             style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setFilterOpen(true)}
            className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0 text-subheadline font-medium"
            style={hasFilters
              ? { background: 'rgba(10,132,255,0.12)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.25)' }
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
              style={{ background: 'rgba(10,132,255,0.12)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.25)' }}>
              {tag.label}
              <button
                onClick={tag.clear}
                className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold leading-none"
                style={{ background: 'rgba(10,132,255,0.2)', color: '#0A84FF' }}>
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
        <div className="pt-4 space-y-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
          {grouped.map(({ month, items, buyTotal, sellTotal }) => (
            <section key={month}>
              <div className="flex items-start justify-between gap-3 px-4 pt-6 pb-3">
                <p className="text-title-1 font-bold">{month}</p>
                <div className="flex gap-3 pt-1 flex-shrink-0">
                  {buyTotal  > 0 && (
                    <span className="text-footnote font-bold uppercase tabnum"
                          style={{ color: 'var(--c-positive)', letterSpacing: '0.04em' }}>
                      Buy: {formatINR(buyTotal)}
                    </span>
                  )}
                  {sellTotal > 0 && (
                    <span className="text-footnote font-bold uppercase tabnum"
                          style={{ color: 'var(--c-negative)', letterSpacing: '0.04em' }}>
                      Sell: {formatINR(sellTotal)}
                    </span>
                  )}
                </div>
              </div>
              <div className="border-t" style={{ borderColor: 'var(--border-faint)' }} />
              <div className="divide-y" style={{ borderColor: 'var(--border-faint)' }}>
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
      <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b"
           style={{ borderColor: 'var(--border)' }}>
        <div style={{ width: 60 }} />
        <p className="font-semibold text-headline">Stock</p>
        <button onClick={onClose}
          className="font-semibold text-headline text-accent"
          style={{ width: 60, textAlign: 'right' }}>
          Done
        </button>
      </div>
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
                style={{ color: value === 'all' ? '#0A84FF' : 'var(--text-primary)', fontWeight: value === 'all' ? 500 : 400 }}>
            Any stock
          </span>
          {value === 'all' && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: '#0A84FF' } as React.CSSProperties} />}
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
                  style={{ color: value === s ? '#0A84FF' : 'var(--text-primary)', fontWeight: value === s ? 500 : 400 }}>
              {s}
            </span>
            {value === s && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: '#0A84FF' } as React.CSSProperties} />}
          </button>
        ))}
      </div>
    </>
  )
}

// ── DateSubSheet ──────────────────────────────────────────────────────────────

function DateSubSheet({ value, selectedFY, onApply, onClose }: {
  value: DateFilter | null
  selectedFY: FiscalYear | null
  onApply: (f: DateFilter | null) => void
  onClose: () => void
}) {
  const initKey = value ? (QUICK_OPTIONS.find(o => o.label === value.label)?.key ?? null) : null
  const [quickKey,    setQuickKey]    = useState<string | null>(initKey)
  const [customFrom,  setCustomFrom]  = useState(value?.from ?? '')
  const [customTo,    setCustomTo]    = useState(value?.to ?? '')

  function selectQuick(key: string) {
    const range = getQuickRange(key, selectedFY)
    setQuickKey(key)
    setCustomFrom(range.from)
    setCustomTo(range.to)
  }

  function handleCustomFrom(v: string) { setCustomFrom(v); setQuickKey(null) }
  function handleCustomTo(v: string)   { setCustomTo(v);   setQuickKey(null) }

  function apply() {
    if (quickKey) {
      const label = QUICK_OPTIONS.find(o => o.key === quickKey)!.label
      onApply({ label, from: customFrom, to: customTo })
    } else if (customFrom && customTo) {
      const fmt = (d: string) =>
        new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
      onApply({ label: `${fmt(customFrom)} – ${fmt(customTo)}`, from: customFrom, to: customTo })
    } else {
      onApply(null)
    }
  }

  const hasValue = !!(quickKey || (customFrom && customTo))

  return (
    <>
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
      </div>
      <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b"
           style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => onApply(null)}
          className="text-headline"
          style={{ color: value ? '#FF3B30' : 'var(--text-muted)', width: 60 }}
          disabled={!value}>
          Clear
        </button>
        <p className="font-semibold text-headline">Date</p>
        <button onClick={apply}
          className="font-semibold text-headline text-accent"
          style={{ width: 60, textAlign: 'right' }}>
          Done
        </button>
      </div>

      {/* Quick selects */}
      <div className="px-5 pt-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <p className="text-footnote uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
          Quick select
        </p>
        {QUICK_OPTIONS.map(opt => (
          <button key={opt.key}
            onClick={() => selectQuick(opt.key)}
            className="w-full flex items-center justify-between py-3.5 border-b last:border-b-0"
            style={{ borderColor: 'var(--border-faint)' }}>
            <span className="text-body"
                  style={{ color: quickKey === opt.key ? '#0A84FF' : 'var(--text-primary)', fontWeight: quickKey === opt.key ? 500 : 400 }}>
              {opt.label}
            </span>
            {quickKey === opt.key && (
              <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: '#0A84FF' } as React.CSSProperties} />
            )}
          </button>
        ))}
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
            style={{
              background: customFrom && !quickKey ? 'rgba(10,132,255,0.08)' : 'var(--bg-tertiary)',
              color:      customFrom && !quickKey ? '#0A84FF' : 'var(--text-primary)',
              border:     customFrom && !quickKey ? '1px solid rgba(10,132,255,0.25)' : '1px solid var(--border)',
              colorScheme: 'light dark',
            }}
          />
          <span className="text-body flex-shrink-0" style={{ color: 'var(--text-faint)' }}>→</span>
          <input
            type="date"
            value={customTo}
            onChange={e => handleCustomTo(e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-xl text-body outline-none"
            style={{
              background: customTo && !quickKey ? 'rgba(10,132,255,0.08)' : 'var(--bg-tertiary)',
              color:      customTo && !quickKey ? '#0A84FF' : 'var(--text-primary)',
              border:     customTo && !quickKey ? '1px solid rgba(10,132,255,0.25)' : '1px solid var(--border)',
              colorScheme: 'light dark',
            }}
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
                         style={{ color: advanceFyId === fy.id ? '#0A84FF' : 'var(--text-primary)' }}>{fy.label}</p>
                      <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>
                        {shortMonthYear(fy.start_date)} – {shortMonthYear(fy.end_date)}
                      </p>
                    </div>
                    {advanceFyId === fy.id && (
                      <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#0A84FF" strokeWidth={2.5}>
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
    <div className="flex items-center px-4 py-4 gap-3 tap-row">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="font-bold text-headline flex-shrink-0">{txn.symbol}</span>
          {getStockName(txn.symbol) && (
            <span className="text-footnote truncate" style={{ color: 'var(--text-muted)' }}>
              {getStockName(txn.symbol)}
            </span>
          )}
          {txn.advance_fy_id && (
            <span className="text-footnote font-semibold px-1.5 py-0.5 rounded-md text-accent flex-shrink-0"
                  style={{ background: 'rgba(10,132,255,0.12)', border: '1px solid rgba(10,132,255,0.25)' }}>
              {`→ ${getFYLabel(txn.advance_fy_id, fiscalYears)}`}
            </span>
          )}
        </div>
        <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {formatDate(txn.trade_date)}
          {' · '}{txn.quantity % 1 === 0 ? txn.quantity : txn.quantity.toFixed(1)} shares
          {' @ ₹'}{txn.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </p>
        {txn.notes && (
          <p className="text-footnote mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>{txn.notes}</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <p className="font-bold tabnum text-headline"
           style={{ color: isBuy ? 'var(--c-positive)' : 'var(--c-negative)' }}>
          {isBuy ? '+' : '−'}{formatINR(txn.amount)}
        </p>
        <button onClick={openEdit}
          className="w-[44px] h-[44px] flex items-center justify-center rounded-xl flex-shrink-0"
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-faint)' }}>
          <PencilIcon className="w-[14px] h-[14px]" />
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
