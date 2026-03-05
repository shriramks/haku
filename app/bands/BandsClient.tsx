'use client'
import { useState } from 'react'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { BandSignalBadge } from '@/components/SignalBadge'
import BandRangeBar from '@/components/BandRangeBar'
import { formatINR } from '@/lib/formatter'
import type { StockRow, BuyBand, BuyTranche } from '@/lib/types'

interface Props {
  rows: StockRow[]
  bands: BuyBand[]
  initialTranches: BuyTranche[]
  fyLabel?: string
}

export default function BandsClient({ rows, bands, initialTranches, fyLabel }: Props) {
  const [tranches, setTranches] = useState(initialTranches)

  async function toggleTranche(id: string, allocated: boolean) {
    setTranches(prev => prev.map(t => t.id === id ? { ...t, allocated } : t))
    await getSupabaseBrowser().from('buy_tranches').update({ allocated }).eq('id', id)
  }

  async function addTranche(symbol: string, qty: number, price: number) {
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const existing = tranches.filter(t => t.symbol === symbol)
    const sort_order = existing.length + 1
    const { data } = await sb.from('buy_tranches').insert({
      user_id: user.id, symbol, qty, price, allocated: false, sort_order,
    }).select().single()
    if (data) setTranches(prev => [...prev, data])
  }

  return (
    <div>
      {rows.map(row => {
        const band = bands.find(b => b.symbol === row.symbol)
        const hasBands = band?.buy_low != null && band?.trim_price != null
        const stockTranches = tranches
          .filter(t => t.symbol === row.symbol)
          .sort((a, b) => a.sort_order - b.sort_order)

        return (
          <div key={row.symbol} className="border-b border-white/5">
            {/* Clickable header → stock detail */}
            <Link href={`/stocks/${row.symbol}?tab=bands`}
                  className="block tap-row px-4 pt-4 pb-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{row.symbol}</span>
                  <BandSignalBadge signal={row.bandSignal} />
                </div>
                <span className="text-white/40 text-sm tabnum">
                  Left: {formatINR(row.remaining)}
                </span>
              </div>

              {hasBands && band ? (
                <>
                  <BandRangeBar
                    buyLow={band.buy_low!}  buyHigh={band.buy_high!}
                    midLow={band.mid_low!}  midHigh={band.mid_high!}
                    trimPrice={band.trim_price!}
                    cmp={band.manual_cmp}
                    height={22}
                  />
                  <div className="grid grid-cols-4 gap-1 mt-2">
                    {[
                      { l: 'Buy',  v: `₹${Math.round(band.buy_low!)}–${Math.round(band.buy_high!)}`, c: 'text-green-400' },
                      { l: 'Mid',  v: `₹${Math.round(band.mid_low!)}–${Math.round(band.mid_high!)}`, c: 'text-orange-400' },
                      { l: 'Trim', v: `≥₹${Math.round(band.trim_price!)}`, c: 'text-red-400' },
                      { l: 'CMP',  v: band.manual_cmp ? `₹${Math.round(band.manual_cmp)}` : '—', c: 'text-white/70' },
                    ].map(({ l, v, c }) => (
                      <div key={l}>
                        <p className={`text-xs font-semibold tabnum ${c}`}>{v}</p>
                        <p className="text-white/30 text-[10px]">{l}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-white/30 text-sm">No bands set — tap to add</p>
              )}
            </Link>

            {/* Tranche section — outside Link to avoid navigation on tap */}
            <TrancheSection
              symbol={row.symbol}
              tranches={stockTranches}
              remaining={row.remaining}
              onToggle={toggleTranche}
              onAdd={addTranche}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── Tranche section per stock ──────────────────────────────────────────────────

function TrancheSection({
  symbol, tranches, remaining, onToggle, onAdd,
}: {
  symbol: string
  tranches: BuyTranche[]
  remaining: number
  onToggle: (id: string, allocated: boolean) => void
  onAdd: (symbol: string, qty: number, price: number) => Promise<void>
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [qty, setQty]         = useState('')
  const [price, setPrice]     = useState('')
  const [adding, setAdding]   = useState(false)

  const pendingTotal = tranches
    .filter(t => !t.allocated)
    .reduce((s, t) => s + t.qty * t.price, 0)

  async function submit() {
    if (!qty || !price) return
    setAdding(true)
    await onAdd(symbol, parseFloat(qty), parseFloat(price))
    setQty(''); setPrice(''); setShowAdd(false); setAdding(false)
  }

  return (
    <div className="px-4 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-white/30 uppercase tracking-widest">Tranches</p>
        <div className="flex items-center gap-3">
          {pendingTotal > 0 && (
            <span className="text-[11px] text-white/30 tabnum">
              {formatINR(pendingTotal)} pending
            </span>
          )}
          <button
            onClick={() => setShowAdd(v => !v)}
            className="text-[#0A84FF] text-[13px]">
            {showAdd ? 'Cancel' : '+ Add'}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="flex gap-2 mb-2">
          <input type="number" inputMode="decimal" placeholder="Qty" value={qty}
            onChange={e => setQty(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl bg-[#2C2C2E] text-white text-[14px] tabnum
                       border border-white/10 outline-none placeholder:text-white/25" />
          <input type="number" inputMode="decimal" placeholder="Price ₹" value={price}
            onChange={e => setPrice(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl bg-[#2C2C2E] text-white text-[14px] tabnum
                       border border-white/10 outline-none placeholder:text-white/25" />
          <button onClick={submit} disabled={adding || !qty || !price}
            className="px-3 py-2 rounded-xl bg-[#0A84FF]/20 text-[#0A84FF] text-[14px]
                       font-semibold disabled:opacity-40">
            {adding ? '…' : 'Add'}
          </button>
        </div>
      )}

      {/* Tranche rows */}
      {tranches.length > 0 && (
        <div className="rounded-2xl bg-[#1C1C1E] divide-y divide-white/[0.06] overflow-hidden">
          {tranches.map(t => (
            <TrancheRow key={t.id} tranche={t} onToggle={onToggle} />
          ))}
        </div>
      )}

      {tranches.length === 0 && !showAdd && (
        <p className="text-white/20 text-[12px]">No tranches — tap + Add to plan buys</p>
      )}
    </div>
  )
}

// ── Single tranche row ─────────────────────────────────────────────────────────

function TrancheRow({ tranche, onToggle }: {
  tranche: BuyTranche
  onToggle: (id: string, allocated: boolean) => void
}) {
  const amount = tranche.qty * tranche.price

  return (
    <div className="flex items-center px-4 py-3 gap-3">
      {/* Circular checkbox */}
      <button
        onClick={() => onToggle(tranche.id, !tranche.allocated)}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0
                    transition-colors ${tranche.allocated
                      ? 'bg-[#30D158] border-[#30D158]'
                      : 'border-white/30 bg-transparent'}`}>
        {tranche.allocated && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24"
               stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      {/* Qty × Price */}
      <p className={`flex-1 text-[13px] tabnum ${
        tranche.allocated ? 'text-white/30 line-through' : 'text-white/70'
      }`}>
        {Math.round(tranche.qty)} × ₹{tranche.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </p>

      {/* Amount + status */}
      <div className="text-right">
        <p className={`text-[13px] font-semibold tabnum ${
          tranche.allocated ? 'text-white/25' : 'text-white/60'
        }`}>
          {formatINR(amount)}
        </p>
        {tranche.allocated && (
          <p className="text-[10px] text-[#30D158]/50 uppercase leading-tight">done</p>
        )}
      </div>
    </div>
  )
}
