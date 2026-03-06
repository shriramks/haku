'use client'
// Primary action — optimised for speed. One-handed, minimal taps.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import BottomNav from '@/components/BottomNav'
import { todayISO, formatINR } from '@/lib/formatter'

export default function AddPage() {
  const router = useRouter()
  const [symbol, setSymbol]         = useState('')
  const [planSymbols, setPlanSymbols] = useState<string[]>([])
  const [type, setType]             = useState<'buy' | 'sell'>('buy')
  const [date, setDate]             = useState(todayISO())
  const [qty, setQty]               = useState('')
  const [price, setPrice]           = useState('')
  const [notes, setNotes]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [done, setDone]             = useState(false)

  useEffect(() => {
    async function loadSymbols() {
      const sb = getSupabaseBrowser()
      const today = new Date().toISOString().slice(0, 10)
      const { data: fys } = await sb
        .from('fiscal_years')
        .select('id')
        .lte('start_date', today)
        .gte('end_date', today)
        .limit(1)
      if (!fys?.length) return
      const { data: allocs } = await sb
        .from('stock_allocations')
        .select('symbol')
        .eq('fy_id', fys[0].id)
        .order('symbol')
      if (allocs) setPlanSymbols(allocs.map(a => a.symbol))
    }
    loadSymbols()
  }, [])

  const amount = (parseFloat(qty) || 0) * (parseFloat(price) || 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!symbol || !qty || !price) return
    setLoading(true)
    setError(null)

    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Infer fy_id from trade date (Apr–Mar cycle)
    const d = new Date(date)
    const month = d.getMonth() + 1
    const fyEndYear = month >= 4 ? d.getFullYear() + 1 : d.getFullYear()
    const fyStart = `${fyEndYear - 1}-04-01`
    const fyEnd   = `${fyEndYear}-03-31`

    const { data: fyRows } = await sb
      .from('fiscal_years')
      .select('id')
      .gte('start_date', fyStart)
      .lte('end_date', fyEnd)
      .limit(1)

    const { error } = await sb.from('transactions').insert({
      user_id:    user.id,
      symbol,
      exchange:   'NSE',
      trade_date: date,
      trade_type: type,
      quantity:   parseFloat(qty),
      price:      parseFloat(price),
      fy_id:      fyRows?.[0]?.id ?? null,
      notes,
    })

    setLoading(false)
    if (error) { setError(error.message); return }

    // Flash success then reset — keep symbol selected for quick back-to-back adds
    setDone(true)
    setTimeout(() => {
      setDone(false)
      setQty('')
      setPrice('')
      setNotes('')
    }, 1200)
  }

  return (
    <>
      <div className="min-h-screen pt-[env(safe-area-inset-top,0px)]">
        {/* Header */}
        <div className="px-4 pt-4 pb-3">
          <h1 className="text-xl font-bold">Add Transaction</h1>
        </div>

        <form onSubmit={submit} className="px-4 space-y-4 pb-8">

          {/* Stock picker */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label className="text-xs text-white/40">Stock</label>
              {symbol && (
                <button type="button" onClick={() => setSymbol('')}
                  className="text-xs text-white/30">
                  clear
                </button>
              )}
            </div>
            {planSymbols.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {planSymbols.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSymbol(s)}
                    className={`px-3 py-2 rounded-xl text-sm font-bold transition-colors ${
                      symbol === s
                        ? type === 'buy'
                          ? 'bg-green-500 text-white'
                          : 'bg-red-500 text-white'
                        : 'bg-white/10 text-white/60'
                    }`}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <div className="h-10 flex items-center">
                <span className="text-sm text-white/30">Loading plan…</span>
              </div>
            )}
          </div>

          {/* Buy / Sell toggle */}
          <div>
            <label className="text-xs text-white/40 mb-2 block">Type</label>
            <div className="flex rounded-xl overflow-hidden border border-white/10">
              {(['buy', 'sell'] as const).map(t => (
                <button key={t} type="button"
                  onClick={() => setType(t)}
                  className={`flex-1 py-3 text-sm font-bold transition-colors ${
                    type === t
                      ? t === 'buy'
                        ? 'bg-green-500 text-white'
                        : 'bg-red-500 text-white'
                      : 'bg-white/5 text-white/40'
                  }`}>
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="text-xs text-white/40 mb-1 block">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
              className="w-full px-3 py-3 rounded-xl bg-white/10 text-white border border-white/10
                         outline-none text-base [color-scheme:dark]"
            />
          </div>

          {/* Qty × Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/40 mb-1 block">Quantity</label>
              <input
                type="number"
                inputMode="decimal"
                placeholder="100"
                value={qty}
                onChange={e => setQty(e.target.value)}
                required min="0.001"
                className="w-full px-3 py-3 rounded-xl bg-white/10 text-white text-base tabnum
                           border border-white/10 outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-white/40 mb-1 block">Price (₹)</label>
              <input
                type="number"
                inputMode="decimal"
                placeholder="1250.50"
                value={price}
                onChange={e => setPrice(e.target.value)}
                required min="0.01"
                className="w-full px-3 py-3 rounded-xl bg-white/10 text-white text-base tabnum
                           border border-white/10 outline-none"
              />
            </div>
          </div>

          {/* Total — live computed */}
          {amount > 0 && (
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5">
              <span className="text-white/40 text-sm">Total</span>
              <span className="font-bold tabnum text-lg">{formatINR(amount)}</span>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs text-white/40 mb-1 block">Notes (optional)</label>
            <input
              type="text"
              placeholder="e.g. Pre-budget dip"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-3 rounded-xl bg-white/10 text-white text-base
                         border border-white/10 outline-none placeholder:text-white/20"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !symbol || !qty || !price}
            className={`w-full py-4 rounded-2xl font-bold text-lg transition-all active:scale-95
              disabled:opacity-40
              ${type === 'buy' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}
              ${done ? 'scale-95 opacity-60' : ''}`}>
            {done ? '✓ Added!' : loading ? '…' : `${type === 'buy' ? 'Buy' : 'Sell'} ${symbol || '…'}`}
          </button>
        </form>
      </div>
      <BottomNav />
    </>
  )
}
