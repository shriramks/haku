'use client'
import { useState } from 'react'
import { formatDate, trimZero } from '@/lib/formatter'
import { Num } from '@/components/Num'
import { RefreshIcon } from '@/components/icons'
import { saveDividends } from '@/app/actions'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import type { DividendTransaction, Transaction } from '@/lib/types'

interface ConfirmItem {
  ex_date: string
  per_share: number
  sharesInput: string
  skip: boolean
}

export default function StockDividends({
  symbol,
  exchange,
  initialDividends,
  initialTransactions,
}: {
  symbol: string
  exchange: string
  initialDividends: DividendTransaction[]
  initialTransactions: Transaction[]
}) {
  const [dividends, setDividends] = useState(initialDividends)
  const [refreshing, setRefreshing] = useState(false)
  const [confirmItems, setConfirmItems] = useState<ConfirmItem[] | null>(null)
  const [upToDate, setUpToDate] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [saving, setSaving] = useState(false)

  function sharesAtDate(date: string): number {
    return initialTransactions
      .filter(t => t.symbol === symbol && t.trade_date <= date)
      .reduce((sum, t) => sum + (t.trade_type === 'buy' ? t.quantity : -t.quantity), 0)
  }

  async function handleRefresh() {
    setRefreshing(true)
    setUpToDate(false)
    setFetchError(false)
    try {
      const res = await fetch(`/api/dividends/fetch/${encodeURIComponent(symbol)}`)
      if (!res.ok) {
        setFetchError(true)
        return
      }
      const fetched: { ex_date: string; per_share: number }[] = await res.json()
      const saved = new Set(dividends.map(d => d.ex_date))
      const newEntries = fetched.filter(e => !saved.has(e.ex_date))
      if (newEntries.length === 0) {
        setUpToDate(true)
        return
      }
      setConfirmItems(newEntries.map(e => {
        const shares = Math.max(0, Math.round(sharesAtDate(e.ex_date)))
        return {
          ex_date: e.ex_date,
          per_share: e.per_share,
          sharesInput: shares > 0 ? String(shares) : '',
          skip: shares === 0,
        }
      }))
    } finally {
      setRefreshing(false)
    }
  }

  async function handleSave() {
    if (!confirmItems) return
    const toSave = confirmItems
      .filter(item => !item.skip)
      .map(item => ({
        symbol,
        exchange,
        ex_date: item.ex_date,
        per_share: item.per_share,
        shares: Math.max(0, parseInt(item.sharesInput) || 0),
      }))
      .filter(r => r.shares > 0)
    if (toSave.length === 0) { setConfirmItems(null); return }
    setSaving(true)
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
    setSaving(false)
    setConfirmItems(null)
  }

  const totalAmount = dividends.reduce((s, d) => s + d.amount, 0)
  const saveCount = confirmItems?.filter(
    i => !i.skip && (parseInt(i.sharesInput) || 0) > 0
  ).length ?? 0

  return (
    <div>
      {/* Section header */}
      <div className="px-4 pt-1 pb-3 flex items-center justify-between">
        <div>
          <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>
            Dividends
          </p>
          {totalAmount > 0 && (
            <p className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}>
              <Num amount={totalAmount} /> total received
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="w-11 h-11 flex items-center justify-center -mr-2"
          style={{ color: refreshing ? 'var(--text-faint)' : 'var(--accent)' }}
        >
          <RefreshIcon className={`w-5 h-5${refreshing ? ' animate-spin' : ''}`} />
        </button>
      </div>

      {upToDate && (
        <p className="px-4 pb-2 text-subheadline" style={{ color: 'var(--text-muted)' }}>
          Already up to date
        </p>
      )}
      {fetchError && (
        <p className="px-4 pb-2 text-subheadline" style={{ color: 'var(--destructive)' }}>
          Failed to fetch dividends — try again
        </p>
      )}

      {/* Payment list */}
      <div>
        {dividends.length === 0 ? (
          <p
            className="px-4 py-3 text-subheadline"
            style={{ borderTop: '1px solid var(--border-faint)', color: 'var(--text-faint)' }}
          >
            No dividends recorded — tap refresh to fetch
          </p>
        ) : (
          dividends.map(d => (
            <div
              key={d.id}
              className="flex items-center px-4 py-3"
              style={{ borderTop: '1px solid var(--border-faint)' }}
            >
              <div className="flex-1">
                <p className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}>
                  {formatDate(d.ex_date)}
                </p>
                <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  {trimZero(d.per_share, 2)}/share · {d.shares.toLocaleString('en-IN')} shares
                </p>
              </div>
              <p className="text-body font-semibold tabnum" style={{ color: 'var(--text-primary)' }}>
                <Num amount={d.amount} />
              </p>
            </div>
          ))
        )}
      </div>

      {/* Confirm sheet */}
      {confirmItems && (
        <BottomSheet onClose={() => { if (!saving) setConfirmItems(null) }}>
          <SheetHeader
            title="Add dividends"
            left={
              <button
                onClick={() => setConfirmItems(null)}
                disabled={saving}
                className="text-accent text-headline"
                style={{ minHeight: 44 }}
              >
                Cancel
              </button>
            }
            right={
              <button
                onClick={handleSave}
                disabled={saving || saveCount === 0}
                className="text-accent text-headline font-semibold disabled:opacity-40"
                style={{ minHeight: 44 }}
              >
                {saving ? '…' : `Save${saveCount > 0 ? ` ${saveCount}` : ''}`}
              </button>
            }
          />

          {/* Scrollable rows */}
          <div className="overflow-y-auto" style={{ maxHeight: '55vh' }}>
            {confirmItems.map((item, idx) => {
              const shares = Math.max(0, parseInt(item.sharesInput) || 0)
              const amount = item.per_share * shares
              return (
                <div
                  key={item.ex_date}
                  className="flex items-center gap-3 px-5 py-3"
                  style={{
                    borderTop: '1px solid var(--border-faint)',
                    opacity: item.skip ? 0.4 : 1,
                    transition: 'opacity 150ms',
                  }}
                >
                  {/* Skip toggle */}
                  <button
                    onClick={() =>
                      setConfirmItems(prev =>
                        prev!.map((ci, i) => i === idx ? { ...ci, skip: !ci.skip } : ci)
                      )
                    }
                    className="w-11 h-11 flex items-center justify-center -ml-2 flex-shrink-0"
                    style={{ color: item.skip ? 'var(--text-faint)' : 'var(--accent)' }}
                  >
                    <CircleCheckIcon active={!item.skip} />
                  </button>

                  {/* Date + per-share */}
                  <div className="flex-1 min-w-0">
                    <p className="text-subheadline tabnum" style={{ color: 'var(--text-primary)' }}>
                      {formatDate(item.ex_date)}
                    </p>
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
                      setConfirmItems(prev =>
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
                    style={{ width: 56, color: 'var(--text-2)' }}
                  >
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
