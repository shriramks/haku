'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Num } from '@/components/Num'
import { formatDate, trimZero } from '@/lib/formatter'
import { ChevronRightIcon } from '@/components/icons'
import BottomSheet from '@/components/BottomSheet'
import StockDividends from '@/components/StockDividends'
import UserMenu from '@/components/UserMenu'
import type { DividendTransaction, Transaction } from '@/lib/types'

type Segment = 'stocks' | 'timeline'

export default function DividendsClient({
  dividends: initialDividends,
  allTxns,
}: {
  dividends: DividendTransaction[]
  allTxns: Transaction[]
}) {
  const router = useRouter()
  const [dividends] = useState(initialDividends)
  const [segment, setSegment] = useState<Segment>('stocks')
  const [filterSymbol, setFilterSymbol] = useState<string | null>(null)
  const [sheetSymbol, setSheetSymbol] = useState<string | null>(null)

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

  // Transactions grouped by symbol for StockDividends
  const txnsBySymbol = new Map<string, Transaction[]>()
  for (const t of allTxns) {
    const arr = txnsBySymbol.get(t.symbol) ?? []
    arr.push(t)
    txnsBySymbol.set(t.symbol, arr)
  }

  const sheetDivs    = sheetSymbol ? dividends.filter(d => d.symbol === sheetSymbol) : []
  const sheetTxns    = sheetSymbol ? (txnsBySymbol.get(sheetSymbol) ?? []) : []
  const sheetExch    = sheetSymbol ? (symbolExchanges.get(sheetSymbol) ?? 'NSE') : 'NSE'

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
          <div style={{ minWidth: 60, display: 'flex', justifyContent: 'flex-end' }}>
            <UserMenu />
          </div>
        </div>
      </div>

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
            Open a stock on the Bands screen and tap the refresh button in the Dividends section
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
    </div>
  )
}
