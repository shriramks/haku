'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Num } from '@/components/Num'
import { formatDate, trimZero } from '@/lib/formatter'
import { ChevronRightIcon, RefreshIcon, FilterIcon, CheckIcon } from '@/components/icons'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import StockDividends from '@/components/StockDividends'
import UserMenu from '@/components/UserMenu'
import { saveDividends } from '@/app/actions'
import type { DividendTransaction, Transaction } from '@/lib/types'

type Segment = 'stocks' | 'timeline'

interface BulkConfirmItem {
  symbol: string
  exchange: string
  ex_date: string
  per_share: number
  sharesInput: string
  skip: boolean
}

export default function DividendsClient({
  dividends: initialDividends,
  allTxns,
}: {
  dividends: DividendTransaction[]
  allTxns: Transaction[]
}) {
  const router = useRouter()
  const [dividends, setDividends] = useState(initialDividends)
  const [segment, setSegment] = useState<Segment>('stocks')
  const [filterSymbol, setFilterSymbol] = useState<string | null>(null)
  const [filterYear, setFilterYear] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [sheetSymbol, setSheetSymbol] = useState<string | null>(null)

  const [bulkRefreshing, setBulkRefreshing] = useState(false)
  const [bulkConfirmItems, setBulkConfirmItems] = useState<BulkConfirmItem[] | null>(null)
  const [bulkUpToDate, setBulkUpToDate] = useState(false)
  const [bulkFetchError, setBulkFetchError] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)

  // All-dividends aggregates (for filter sheet lists)
  const symbolExchanges = new Map<string, string>()
  const allSymbolTotals = new Map<string, number>()
  for (const d of dividends) {
    if (!symbolExchanges.has(d.symbol)) symbolExchanges.set(d.symbol, d.exchange)
    allSymbolTotals.set(d.symbol, (allSymbolTotals.get(d.symbol) ?? 0) + d.amount)
  }
  const allSymbols = [...allSymbolTotals.keys()].sort(
    (a, b) => (allSymbolTotals.get(b) ?? 0) - (allSymbolTotals.get(a) ?? 0)
  )
  const allYears = [...new Set(dividends.map(d => d.ex_date.slice(0, 4)))].sort().reverse()

  // Filtered set — drives all visible data
  const filtered = dividends.filter(d =>
    (!filterSymbol || d.symbol === filterSymbol) &&
    (!filterYear   || d.ex_date.startsWith(filterYear))
  )
  const totalAmount  = filtered.reduce((s, d) => s + d.amount, 0)
  const filteredCount = filtered.length

  // Per-symbol aggregates within filtered set (for By Stock view)
  const filteredSymbolTotals = new Map<string, number>()
  const filteredSymbolCounts = new Map<string, number>()
  for (const d of filtered) {
    filteredSymbolTotals.set(d.symbol, (filteredSymbolTotals.get(d.symbol) ?? 0) + d.amount)
    filteredSymbolCounts.set(d.symbol, (filteredSymbolCounts.get(d.symbol) ?? 0) + 1)
  }
  const filteredSymbols = [...filteredSymbolTotals.keys()].sort(
    (a, b) => (filteredSymbolTotals.get(b) ?? 0) - (filteredSymbolTotals.get(a) ?? 0)
  )

  const filteredTimeline = [...filtered].sort((a, b) => b.ex_date.localeCompare(a.ex_date))

  // Transactions grouped by symbol for StockDividends + bulk refresh
  const txnsBySymbol = new Map<string, Transaction[]>()
  for (const t of allTxns) {
    const arr = txnsBySymbol.get(t.symbol) ?? []
    arr.push(t)
    txnsBySymbol.set(t.symbol, arr)
  }

  const sheetDivs = sheetSymbol ? dividends.filter(d => d.symbol === sheetSymbol) : []
  const sheetTxns = sheetSymbol ? (txnsBySymbol.get(sheetSymbol) ?? []) : []
  const sheetExch = sheetSymbol ? (symbolExchanges.get(sheetSymbol) ?? 'NSE') : 'NSE'

  const hasFilters = filterSymbol !== null || filterYear !== null

  function clearFilters() {
    setFilterSymbol(null)
    setFilterYear(null)
  }

  function sharesAtDate(symbol: string, date: string): number {
    return (txnsBySymbol.get(symbol) ?? [])
      .filter(t => t.trade_date <= date)
      .reduce((sum, t) => sum + (t.trade_type === 'buy' ? t.quantity : -t.quantity), 0)
  }

  async function handleRefreshAll() {
    setBulkRefreshing(true)
    setBulkUpToDate(false)
    setBulkFetchError(false)

    const symbolList = [...txnsBySymbol.keys()].filter(sym => {
      const txns = txnsBySymbol.get(sym) ?? []
      return txns.reduce((sum, t) => sum + (t.trade_type === 'buy' ? t.quantity : -t.quantity), 0) > 0
    })
    const exchangeFor = (sym: string) =>
      symbolExchanges.get(sym) ?? txnsBySymbol.get(sym)?.[0]?.exchange ?? 'NSE'

    try {
      const results = await Promise.allSettled(
        symbolList.map(sym =>
          fetch(`/api/dividends/fetch/${encodeURIComponent(sym)}`).then(r =>
            r.ok
              ? (r.json() as Promise<{ ex_date: string; per_share: number }[]>)
              : Promise.reject()
          )
        )
      )

      const allNew: BulkConfirmItem[] = []
      let anyError = false

      for (let i = 0; i < symbolList.length; i++) {
        const sym = symbolList[i]
        const result = results[i]
        if (result.status === 'rejected') { anyError = true; continue }
        const saved = new Set(dividends.filter(d => d.symbol === sym).map(d => d.ex_date))
        for (const e of result.value.filter(e => !saved.has(e.ex_date))) {
          const shares = Math.max(0, Math.round(sharesAtDate(sym, e.ex_date)))
          allNew.push({
            symbol: sym,
            exchange: exchangeFor(sym),
            ex_date: e.ex_date,
            per_share: e.per_share,
            sharesInput: shares > 0 ? String(shares) : '',
            skip: shares === 0,
          })
        }
      }

      if (anyError) setBulkFetchError(true)
      if (allNew.length === 0) { setBulkUpToDate(true); return }

      allNew.sort((a, b) => b.ex_date.localeCompare(a.ex_date))
      setBulkConfirmItems(allNew)
    } finally {
      setBulkRefreshing(false)
    }
  }

  async function handleBulkSave() {
    if (!bulkConfirmItems) return
    const toSave = bulkConfirmItems
      .filter(item => !item.skip)
      .map(item => ({
        symbol: item.symbol,
        exchange: item.exchange,
        ex_date: item.ex_date,
        per_share: item.per_share,
        shares: Math.max(0, parseInt(item.sharesInput) || 0),
      }))
      .filter(r => r.shares > 0)
    if (toSave.length === 0) { setBulkConfirmItems(null); return }
    setBulkSaving(true)
    await saveDividends(toSave)
    setDividends(prev => {
      const merged = [...prev]
      for (const r of toSave) {
        merged.push({
          id: `${r.symbol}_${r.ex_date}`,
          symbol: r.symbol,
          exchange: r.exchange,
          ex_date: r.ex_date,
          per_share: r.per_share,
          shares: r.shares,
          amount: r.per_share * r.shares,
        })
      }
      return merged.sort((a, b) => b.ex_date.localeCompare(a.ex_date))
    })
    setBulkSaving(false)
    setBulkConfirmItems(null)
  }

  const bulkSaveCount = bulkConfirmItems?.filter(
    i => !i.skip && (parseInt(i.sharesInput) || 0) > 0
  ).length ?? 0

  return (
    <div style={{ minHeight: '100dvh', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

      {/* Nav */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b"
        style={{ background: 'var(--bg-nav)', borderColor: 'var(--border)', paddingTop: 'max(env(safe-area-inset-top,0px), 16px)' }}>
        <div className="flex items-center justify-between px-4 pb-3">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 text-body"
            style={{ color: 'var(--accent)', minWidth: 60, minHeight: 44 }}>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M7 1L1 7l6 6" />
            </svg>
            Back
          </button>
          <span className="text-headline font-semibold">Dividends</span>
          <div className="flex items-center gap-2" style={{ minWidth: 60, justifyContent: 'flex-end' }}>
            <button
              onClick={handleRefreshAll}
              disabled={bulkRefreshing}
              className="w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: 'var(--bg-tertiary)', color: bulkRefreshing ? 'var(--text-faint)' : 'var(--accent)' }}>
              <RefreshIcon className={`w-5 h-5${bulkRefreshing ? ' animate-spin' : ''}`} />
            </button>
            <UserMenu />
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-2 px-4 pt-1 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setFilterOpen(true)}
            className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0 text-subheadline font-medium"
            style={hasFilters
              ? { background: 'rgba(10,132,255,0.12)', color: 'var(--accent)', border: '1px solid rgba(10,132,255,0.25)' }
              : { background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
            <FilterIcon className="w-3.5 h-3.5" />
            Filter
          </button>

          {hasFilters && (
            <div className="w-px self-stretch my-1.5 flex-shrink-0" style={{ background: 'var(--border)' }} />
          )}

          {filterSymbol && (
            <div
              className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0 text-subheadline font-medium"
              style={{ background: 'rgba(10,132,255,0.12)', color: 'var(--accent)', border: '1px solid rgba(10,132,255,0.25)' }}>
              {filterSymbol}
              <button
                onClick={() => setFilterSymbol(null)}
                className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold leading-none"
                style={{ background: 'rgba(10,132,255,0.20)', color: 'var(--accent)' }}>
                ×
              </button>
            </div>
          )}

          {filterYear && (
            <div
              className="flex items-center gap-1.5 px-3 h-9 rounded-full flex-shrink-0 text-subheadline font-medium"
              style={{ background: 'rgba(10,132,255,0.12)', color: 'var(--accent)', border: '1px solid rgba(10,132,255,0.25)' }}>
              {filterYear}
              <button
                onClick={() => setFilterYear(null)}
                className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold leading-none"
                style={{ background: 'rgba(10,132,255,0.20)', color: 'var(--accent)' }}>
                ×
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bulk status messages */}
      {bulkUpToDate && (
        <p className="px-4 py-2 text-subheadline" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-faint)' }}>
          Already up to date
        </p>
      )}
      {bulkFetchError && !bulkConfirmItems && (
        <p className="px-4 py-2 text-subheadline text-negative" style={{ borderBottom: '1px solid var(--border-faint)' }}>
          Some stocks failed to fetch — try again
        </p>
      )}

      {/* Summary strip */}
      <div
        className="px-4 pt-4 pb-3 border-b"
        style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-faint)' }}>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1px 1fr', alignItems: 'start' }}>
          <div className="flex flex-col gap-0.5">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>
              Total received
            </p>
            <p className="text-title-2 font-bold tabnum" style={{ marginTop: 2 }}>
              <Num amount={totalAmount} />
            </p>
          </div>
          <div style={{ width: 1, height: 44, background: 'var(--border-faint)' }} />
          <div className="flex flex-col gap-0.5 items-end">
            <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>
              Dividends
            </p>
            <p className="text-title-2 font-bold tabnum" style={{ marginTop: 2 }}>
              {filteredCount}
            </p>
          </div>
        </div>
      </div>

      {/* Segment control */}
      <div
        className="px-4 pt-3"
        style={{ background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-faint)' }}>
        <div
          className="flex rounded-xl p-0.5 mb-3 gap-0.5"
          style={{ background: 'var(--bg-tertiary)' }}>
          {(['stocks', 'timeline'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSegment(s)}
              className="flex-1 py-2 rounded-[10px] text-subheadline font-medium transition-all"
              style={{
                background: segment === s ? 'var(--bg-secondary)' : 'transparent',
                color: segment === s ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: segment === s ? '0 1px 4px rgba(0,0,0,0.10)' : undefined,
              }}>
              {s === 'stocks' ? 'By Stock' : 'Timeline'}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {dividends.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>
            No dividends recorded yet
          </p>
          <p className="text-footnote mt-2" style={{ color: 'var(--text-faint)', lineHeight: 1.5 }}>
            Tap the refresh button above to fetch for all your stocks
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>
            No dividends match these filters
          </p>
        </div>
      ) : segment === 'stocks' ? (
        // ── By Stock ──
        <div>
          {filteredSymbols.map(sym => {
            const total = filteredSymbolTotals.get(sym) ?? 0
            const count = filteredSymbolCounts.get(sym) ?? 0
            return (
              <button
                key={sym}
                onClick={() => setSheetSymbol(sym)}
                className="flex items-center w-full px-4 py-3 tap-row"
                style={{ borderBottom: '1px solid var(--border-faint)' }}>
                <div className="flex-1 text-left">
                  <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {sym}
                  </p>
                  <p className="text-footnote mt-0.5" style={{ color: 'var(--text-faint)' }}>
                    {count} payment{count !== 1 ? 's' : ''}
                  </p>
                </div>
                <p className="text-body font-semibold tabnum mr-2" style={{ color: 'var(--text-primary)' }}>
                  <Num amount={total} />
                </p>
                <ChevronRightIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
              </button>
            )
          })}
        </div>
      ) : (
        // ── Timeline ──
        <div>
          {filteredTimeline.map(d => (
            <div
              key={d.id}
              className="flex items-center px-4 py-3"
              style={{ borderBottom: '1px solid var(--border-faint)' }}>
              <div className="flex-1">
                <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {d.symbol}
                </p>
                <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  {formatDate(d.ex_date)} · {trimZero(d.per_share, 2)}/share · {d.shares.toLocaleString('en-IN')} shares
                </p>
              </div>
              <p className="text-body font-semibold tabnum" style={{ color: 'var(--text-primary)' }}>
                <Num amount={d.amount} />
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Filter sheet */}
      {filterOpen && (
        <BottomSheet onClose={() => setFilterOpen(false)} className="overflow-y-auto max-h-[80vh]">
          <SheetHeader
            title="Filter"
            left={
              <button
                onClick={() => { clearFilters(); setFilterOpen(false) }}
                className="text-accent text-headline"
                style={{ minHeight: 44 }}>
                Clear
              </button>
            }
            right={
              <button
                onClick={() => setFilterOpen(false)}
                className="text-accent text-headline font-semibold"
                style={{ minHeight: 44 }}>
                Done
              </button>
            }
          />

          {/* Stock section */}
          <p className="text-footnote font-bold uppercase px-5 pt-4 pb-1.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>
            Stock
          </p>
          <button
            onClick={() => setFilterSymbol(null)}
            className="w-full flex items-center justify-between px-5 border-b"
            style={{ minHeight: 52, borderColor: 'var(--border-faint)', background: !filterSymbol ? 'rgba(10,132,255,0.04)' : undefined }}>
            <span className="text-body" style={{ color: !filterSymbol ? 'var(--accent)' : 'var(--text-primary)', fontWeight: !filterSymbol ? 500 : 400 }}>
              All stocks
            </span>
            {!filterSymbol && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' }} />}
          </button>
          {allSymbols.map(sym => (
            <button
              key={sym}
              onClick={() => setFilterSymbol(sym)}
              className="w-full flex items-center justify-between px-5 border-b last:border-b-0"
              style={{ minHeight: 52, borderColor: 'var(--border-faint)', background: filterSymbol === sym ? 'rgba(10,132,255,0.04)' : undefined }}>
              <span className="text-body" style={{ color: filterSymbol === sym ? 'var(--accent)' : 'var(--text-primary)', fontWeight: filterSymbol === sym ? 500 : 400 }}>
                {sym}
              </span>
              {filterSymbol === sym && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' }} />}
            </button>
          ))}

          {/* Year section */}
          {allYears.length > 0 && (
            <>
              <p className="text-footnote font-bold uppercase px-5 pt-4 pb-1.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>
                Year
              </p>
              <button
                onClick={() => setFilterYear(null)}
                className="w-full flex items-center justify-between px-5 border-b"
                style={{ minHeight: 52, borderColor: 'var(--border-faint)', background: !filterYear ? 'rgba(10,132,255,0.04)' : undefined }}>
                <span className="text-body" style={{ color: !filterYear ? 'var(--accent)' : 'var(--text-primary)', fontWeight: !filterYear ? 500 : 400 }}>
                  All years
                </span>
                {!filterYear && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' }} />}
              </button>
              {allYears.map(year => (
                <button
                  key={year}
                  onClick={() => setFilterYear(year)}
                  className="w-full flex items-center justify-between px-5 border-b last:border-b-0"
                  style={{ minHeight: 52, borderColor: 'var(--border-faint)', background: filterYear === year ? 'rgba(10,132,255,0.04)' : undefined }}>
                  <span className="text-body" style={{ color: filterYear === year ? 'var(--accent)' : 'var(--text-primary)', fontWeight: filterYear === year ? 500 : 400 }}>
                    {year}
                  </span>
                  {filterYear === year && <CheckIcon className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' }} />}
                </button>
              ))}
            </>
          )}
        </BottomSheet>
      )}

      {/* Stock detail sheet */}
      {sheetSymbol && (
        <BottomSheet onClose={() => setSheetSymbol(null)} className="overflow-y-auto max-h-[90vh]">
          <SheetHeader
            title={sheetSymbol}
            right={
              <button
                onClick={() => setSheetSymbol(null)}
                className="text-accent text-headline font-semibold"
                style={{ minHeight: 44 }}>
                Done
              </button>
            }
          />
          <StockDividends
            symbol={sheetSymbol}
            exchange={sheetExch}
            initialDividends={sheetDivs}
            initialTransactions={sheetTxns}
          />
        </BottomSheet>
      )}

      {/* Bulk confirm sheet */}
      {bulkConfirmItems && (
        <BottomSheet onClose={() => { if (!bulkSaving) setBulkConfirmItems(null) }}>
          <SheetHeader
            title="Add dividends"
            left={
              <button
                onClick={() => setBulkConfirmItems(null)}
                disabled={bulkSaving}
                className="text-accent text-headline"
                style={{ minHeight: 44 }}>
                Cancel
              </button>
            }
            right={
              <button
                onClick={handleBulkSave}
                disabled={bulkSaving || bulkSaveCount === 0}
                className="text-accent text-headline font-semibold disabled:opacity-40"
                style={{ minHeight: 44 }}>
                {bulkSaving ? '…' : `Save${bulkSaveCount > 0 ? ` ${bulkSaveCount}` : ''}`}
              </button>
            }
          />

          <div className="overflow-y-auto" style={{ maxHeight: '55vh' }}>
            {bulkConfirmItems.map((item, idx) => {
              const shares = Math.max(0, parseInt(item.sharesInput) || 0)
              const amount = item.per_share * shares
              return (
                <div
                  key={`${item.symbol}_${item.ex_date}`}
                  className="flex items-center gap-3 px-5 py-3"
                  style={{
                    borderTop: '1px solid var(--border-faint)',
                    opacity: item.skip ? 0.4 : 1,
                    transition: 'opacity 150ms',
                  }}>
                  {/* Skip toggle */}
                  <button
                    onClick={() =>
                      setBulkConfirmItems(prev =>
                        prev!.map((ci, i) => i === idx ? { ...ci, skip: !ci.skip } : ci)
                      )
                    }
                    className="w-11 h-11 flex items-center justify-center -ml-2 flex-shrink-0"
                    style={{ color: item.skip ? 'var(--text-faint)' : 'var(--accent)' }}>
                    <CircleCheckIcon active={!item.skip} />
                  </button>

                  {/* Symbol + date + per-share */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <p className="text-subheadline font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {item.symbol}
                      </p>
                      <p className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}>
                        {formatDate(item.ex_date)}
                      </p>
                    </div>
                    <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--text-faint)' }}>
                      {trimZero(item.per_share, 2)}/share
                    </p>
                  </div>

                  {/* Shares input */}
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="shares"
                    value={item.sharesInput}
                    disabled={item.skip}
                    onChange={e =>
                      setBulkConfirmItems(prev =>
                        prev!.map((ci, i) =>
                          i === idx ? { ...ci, sharesInput: e.target.value } : ci
                        )
                      )
                    }
                    className="tabnum text-right"
                    style={{
                      width: 76,
                      padding: '8px 10px',
                      borderRadius: 10,
                      fontSize: 15,
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                      outline: 'none',
                    }}
                  />

                  {/* Amount */}
                  <p
                    className="text-body font-semibold tabnum text-right flex-shrink-0"
                    style={{ width: 56, color: 'var(--text-2)' }}>
                    {amount > 0 ? <Num amount={amount} /> : '—'}
                  </p>
                </div>
              )
            })}
          </div>
        </BottomSheet>
      )}
    </div>
  )
}

function CircleCheckIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="10" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 11l2.5 2.5L15 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
