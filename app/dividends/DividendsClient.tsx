'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Num } from '@/components/Num'
import { formatDate, trimZero } from '@/lib/formatter'
import { ChevronRightIcon, RefreshIcon } from '@/components/icons'
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
  const [sheetSymbol, setSheetSymbol] = useState<string | null>(null)

  const [bulkRefreshing, setBulkRefreshing] = useState(false)
  const [bulkConfirmItems, setBulkConfirmItems] = useState<BulkConfirmItem[] | null>(null)
  const [bulkUpToDate, setBulkUpToDate] = useState(false)
  const [bulkFetchError, setBulkFetchError] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)

  // Aggregate totals per symbol
  const symbolTotals = new Map<string, number>()
  const symbolCounts = new Map<string, number>()
  const symbolExchanges = new Map<string, string>()
  for (const d of dividends) {
    symbolTotals.set(d.symbol, (symbolTotals.get(d.symbol) ?? 0) + d.amount)
    symbolCounts.set(d.symbol, (symbolCounts.get(d.symbol) ?? 0) + 1)
    if (!symbolExchanges.has(d.symbol)) symbolExchanges.set(d.symbol, d.exchange)
  }
  const sortedSymbols = [...symbolTotals.keys()].sort(
    (a, b) => (symbolTotals.get(b) ?? 0) - (symbolTotals.get(a) ?? 0)
  )

  const filtered = filterSymbol ? dividends.filter(d => d.symbol === filterSymbol) : dividends
  const totalAmount = filtered.reduce((s, d) => s + d.amount, 0)
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

  function sharesAtDate(symbol: string, date: string): number {
    return (txnsBySymbol.get(symbol) ?? [])
      .filter(t => t.trade_date <= date)
      .reduce((sum, t) => sum + (t.trade_type === 'buy' ? t.quantity : -t.quantity), 0)
  }

  async function handleRefreshAll() {
    setBulkRefreshing(true)
    setBulkUpToDate(false)
    setBulkFetchError(false)

    const symbolList = [...txnsBySymbol.keys()]
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
          <div className="flex items-center" style={{ minWidth: 60, justifyContent: 'flex-end' }}>
            <button
              onClick={handleRefreshAll}
              disabled={bulkRefreshing}
              className="w-11 h-11 flex items-center justify-center"
              style={{ color: bulkRefreshing ? 'var(--text-faint)' : 'var(--accent)' }}>
              <RefreshIcon className={`w-5 h-5${bulkRefreshing ? ' animate-spin' : ''}`} />
            </button>
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Bulk status messages */}
      {bulkUpToDate && (
        <p className="px-4 py-2 text-subheadline" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-faint)' }}>
          Already up to date
        </p>
      )}
      {bulkFetchError && !bulkConfirmItems && (
        <p className="px-4 py-2 text-subheadline" style={{ color: 'var(--destructive)', borderBottom: '1px solid var(--border-faint)' }}>
          Some stocks failed to fetch — try again
        </p>
      )}

      {/* Hero */}
      <div className="px-4 pt-5 pb-4" style={{ background: 'var(--bg-primary)' }}>
        <p className="text-display font-bold tabnum" style={{ color: 'var(--text-primary)' }}>
          <Num amount={totalAmount} />
        </p>
        <p className="text-subheadline mt-1" style={{ color: 'var(--text-muted)' }}>
          {filterSymbol ? `${filterSymbol} · total received` : 'Total received'}
        </p>
      </div>

      {/* Segment + filter */}
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

        {sortedSymbols.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4" style={{ scrollbarWidth: 'none' }}>
            <button
              onClick={() => setFilterSymbol(null)}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-subheadline font-medium"
              style={{
                background: !filterSymbol ? 'var(--accent)' : 'var(--bg-secondary)',
                color: !filterSymbol ? '#fff' : 'var(--text-2)',
                border: `1px solid ${!filterSymbol ? 'transparent' : 'var(--border)'}`,
              }}>
              All
            </button>
            {sortedSymbols.map(sym => (
              <button
                key={sym}
                onClick={() => setFilterSymbol(filterSymbol === sym ? null : sym)}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg text-subheadline font-medium"
                style={{
                  background: filterSymbol === sym ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: filterSymbol === sym ? '#fff' : 'var(--text-2)',
                  border: `1px solid ${filterSymbol === sym ? 'transparent' : 'var(--border)'}`,
                }}>
                {sym}
              </button>
            ))}
          </div>
        )}
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
      ) : segment === 'stocks' ? (
        // ── By Stock ──
        <div>
          {sortedSymbols
            .filter(sym => !filterSymbol || sym === filterSymbol)
            .map(sym => {
              const total    = symbolTotals.get(sym) ?? 0
              const count    = symbolCounts.get(sym) ?? 0
              const exchange = symbolExchanges.get(sym) ?? 'NSE'
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
                      {exchange} · {count} payment{count !== 1 ? 's' : ''}
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
                <div className="flex items-center gap-2">
                  <p className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}>
                    {formatDate(d.ex_date)}
                  </p>
                  {!filterSymbol && (
                    <p className="text-subheadline font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {d.symbol}
                    </p>
                  )}
                </div>
                <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  {trimZero(d.per_share, 2)}/share · {d.shares.toLocaleString('en-IN')} shares
                </p>
              </div>
              <p className="text-body font-semibold tabnum" style={{ color: 'var(--text-primary)' }}>
                <Num amount={d.amount} />
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Stock detail sheet */}
      {sheetSymbol && (
        <BottomSheet onClose={() => setSheetSymbol(null)} className="overflow-y-auto max-h-[90vh]">
          <div
            className="flex items-center justify-between px-5 pt-3 pb-2"
            style={{ borderBottom: '1px solid var(--border-faint)' }}>
            <p className="text-title-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
              {sheetSymbol}
            </p>
            <button
              onClick={() => setSheetSymbol(null)}
              className="text-accent text-body font-medium"
              style={{ minHeight: 44, minWidth: 44, textAlign: 'right' }}>
              Done
            </button>
          </div>
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
