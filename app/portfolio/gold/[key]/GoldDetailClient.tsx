'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { formatINRFull, formatPriceNum, formatPnLFull, trimPct, getGainColor } from '@/lib/formatter'
import UserMenu from '@/components/UserMenu'
import EmptyState from '@/components/EmptyState'
import { aggregateSGBBatch, goldDisplayName, goldMeta } from '@/lib/sgb-compute'
import { TxnRow, sgbToDisplayTxn } from '@/components/EditableTxnRow'
import type { SGBTransaction } from '@/lib/portfolio-types'

interface Props {
  batchKey: string
  transactions: SGBTransaction[]
}

function groupByMonth(txns: SGBTransaction[]) {
  const map = new Map<string, SGBTransaction[]>()
  for (const t of txns) {
    const key = new Date(t.trade_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    ;(map.get(key) ?? map.set(key, []).get(key)!).push(t)
  }
  return Array.from(map.entries()).map(([month, items]) => ({ month, items }))
}

export default function GoldDetailClient({ batchKey, transactions: initialTransactions }: Props) {
  const router = useRouter()
  const [transactions, setTransactions] = useState(initialTransactions)
  const [goldPrice, setGoldPrice]         = useState<number | null>(null)
  const [priceLoading, setPriceLoading]   = useState(true)

  function updateTxn(u: SGBTransaction) { setTransactions(prev => prev.map(t => t.id === u.id ? u : t)) }
  function deleteTxn(id: string)        { setTransactions(prev => prev.filter(t => t.id !== id)) }

  useEffect(() => {
    fetch('/api/gold-price')
      .then(r => r.json())
      .then(d => setGoldPrice(d.pricePerGram ?? null))
      .catch(() => setGoldPrice(null))
      .finally(() => setPriceLoading(false))
  }, [])

  const batch = useMemo(
    () => aggregateSGBBatch(batchKey, transactions, priceLoading ? null : goldPrice),
    [batchKey, transactions, goldPrice, priceLoading]
  )

  const sortedTxns = useMemo(
    () => [...transactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date)),
    [transactions]
  )
  const grouped = useMemo(() => groupByMonth(sortedTxns), [sortedTxns])

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl border-b"
           style={{ background: 'var(--bg-nav)', borderColor: 'var(--border)', paddingTop: 'max(env(safe-area-inset-top,0px), 16px)' }}>
        <div className="flex items-center justify-between px-4 pb-3">
          <button onClick={() => router.push('/portfolio')}
                  className="flex items-center gap-1 text-body flex-shrink-0"
                  style={{ color: 'var(--accent)', minWidth: 60, minHeight: 44 }}>
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M7 1L1 7l6 6" /></svg>
            Portfolio
          </button>
          <span className="text-headline font-semibold">Gold</span>
          <div style={{ minWidth: 60 }} className="flex justify-end">
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Batch title */}
      <div className="px-4" style={{ paddingTop: 18, paddingBottom: 4 }}>
        <p className="text-title-1 font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {goldDisplayName(batch)}
        </p>
        <p className="text-subheadline tabnum mt-1" style={{ color: 'var(--text-muted)' }}>
          {goldMeta(batch)}
        </p>
      </div>

      {/* Summary */}
      <div className="px-4" style={{ paddingTop: 8 }}>
        <DetailRow label="Current Value" value={batch.currentValue != null ? formatINRFull(batch.currentValue) : '—'} />
        <DetailRow label="Invested Value" value={formatINRFull(batch.invested)} />
        <DetailRow
          label="Current Return"
          value={formatPnLFull(batch.gain)}
          valueColor={getGainColor(batch.gain)}
        />
        <DetailRow
          label="XIRR p.a."
          value={batch.xirr != null ? `${trimPct(Math.abs(batch.xirr * 100))}%` : '—'}
          valueColor={getGainColor(batch.xirr)}
        />
        <DetailRow label="Gold Price / g" value={goldPrice != null ? formatPriceNum(goldPrice) : '—'} last />
      </div>

      {/* Transactions */}
      <div className="flex items-baseline justify-between px-4" style={{ paddingTop: 24, paddingBottom: 6 }}>
        <span className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em' }}>Transactions</span>
        <span className="text-footnote tabnum" style={{ color: 'var(--text-faint)' }}>{sortedTxns.length}</span>
      </div>

      {sortedTxns.length === 0 ? (
        <EmptyState>No transactions yet.</EmptyState>
      ) : (
        grouped.map(({ month, items }) => (
          <div key={month}>
            <div className="px-4 py-1.5" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <span className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>{month}</span>
            </div>
            {items.map(t => (
              <TxnRow key={t.id}
                txn={sgbToDisplayTxn(t)}
                showAssetTag={false}
                onDelete={deleteTxn}
                onSavedStock={() => {}}
                onSavedMF={() => {}}
                onSavedSGB={updateTxn}
                onSavedPPF={() => {}}
                onSavedEPF={() => {}}
              />
            ))}
          </div>
        ))
      )}
    </div>
  )
}

function DetailRow({ label, value, valueColor, last: _last }: {
  label: string; value: string; valueColor?: string; last?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3" style={{ minHeight: 52, borderBottom: _last ? 'none' : '1px solid var(--divider)' }}>
      <p className="text-body" style={{ color: 'var(--text-2)' }}>{label}</p>
      <p className="text-headline font-semibold tabnum text-right" style={{ color: valueColor ?? 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  )
}
