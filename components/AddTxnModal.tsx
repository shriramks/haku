'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { todayISO, formatINR } from '@/lib/formatter'

export default function AddTxnModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [symbol, setSymbol] = useState('')
  const [type, setType]     = useState<'buy' | 'sell'>('buy')
  const [date, setDate]     = useState(todayISO())
  const [qty, setQty]       = useState('')
  const [price, setPrice]   = useState('')
  const [notes, setNotes]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState(false)

  const amount = (parseFloat(qty) || 0) * (parseFloat(price) || 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!symbol || !qty || !price) return
    setLoading(true); setError(null)

    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { onClose(); return }

    // Infer fy_id from trade date (Apr–Mar cycle)
    const d = new Date(date)
    const fyEndYear = (d.getMonth() + 1) >= 4 ? d.getFullYear() + 1 : d.getFullYear()
    const { data: fyRows } = await sb
      .from('fiscal_years').select('id')
      .gte('start_date', `${fyEndYear - 1}-04-01`)
      .lte('end_date', `${fyEndYear}-03-31`)
      .limit(1)

    const { error } = await sb.from('transactions').insert({
      user_id: user.id, symbol, exchange: 'NSE',
      trade_date: date, trade_type: type,
      quantity: parseFloat(qty), price: parseFloat(price),
      fy_id: fyRows?.[0]?.id ?? null, notes,
    })

    setLoading(false)
    if (error) { setError(error.message); return }
    setDone(true)
    setTimeout(() => { router.refresh(); onClose() }, 700)
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up
                      bg-[#1C1C1E] rounded-t-[28px] max-h-[92vh] overflow-y-auto
                      pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-1 pb-4">
          <button onClick={onClose} className="text-[#0A84FF] text-[17px]">Cancel</button>
          <p className="font-semibold text-[17px]">New Transaction</p>
          <div className="w-16" />
        </div>

        <form onSubmit={submit} className="px-4 space-y-3">
          {/* Symbol + type */}
          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-[11px] text-white/40 mb-1.5 uppercase tracking-wide">Stock</p>
              <input
                type="text"
                placeholder="INFY, CAMS…"
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                required
                className="w-full px-3 py-3.5 rounded-2xl bg-[#2C2C2E] text-white text-[17px] font-semibold
                           border border-white/8 outline-none uppercase placeholder:normal-case placeholder:text-white/25"
              />
            </div>
            <div>
              <p className="text-[11px] text-white/40 mb-1.5 uppercase tracking-wide">Type</p>
              <div className="flex rounded-2xl overflow-hidden border border-white/8">
                {(['buy', 'sell'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setType(t)}
                    className={`px-5 py-3.5 text-[15px] font-bold transition-colors ${
                      type === t
                        ? t === 'buy' ? 'bg-[#30D158] text-white' : 'bg-[#FF453A] text-white'
                        : 'bg-[#2C2C2E] text-white/40'
                    }`}>
                    {t === 'buy' ? 'Buy' : 'Sell'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Date */}
          <div>
            <p className="text-[11px] text-white/40 mb-1.5 uppercase tracking-wide">Date</p>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required
              className="w-full px-3 py-3.5 rounded-2xl bg-[#2C2C2E] text-white border border-white/8
                         outline-none text-[17px] [color-scheme:dark]" />
          </div>

          {/* Qty × Price */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Quantity', val: qty, set: setQty, ph: '100' },
              { label: 'Price (₹)', val: price, set: setPrice, ph: '1250.50' },
            ].map(({ label, val, set, ph }) => (
              <div key={label}>
                <p className="text-[11px] text-white/40 mb-1.5 uppercase tracking-wide">{label}</p>
                <input type="number" inputMode="decimal" placeholder={ph} value={val}
                  onChange={e => set(e.target.value)} required min="0.001"
                  className="w-full px-3 py-3.5 rounded-2xl bg-[#2C2C2E] text-white text-[17px] tabnum
                             border border-white/8 outline-none" />
              </div>
            ))}
          </div>

          {/* Live total */}
          {amount > 0 && (
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-[#2C2C2E]">
              <span className="text-white/50 text-[15px]">Total</span>
              <span className={`font-bold tabnum text-[20px] ${type === 'buy' ? 'text-[#30D158]' : 'text-[#FF453A]'}`}>
                {formatINR(amount)}
              </span>
            </div>
          )}

          {/* Notes */}
          <div>
            <p className="text-[11px] text-white/40 mb-1.5 uppercase tracking-wide">Notes (optional)</p>
            <input type="text" placeholder="e.g. Pre-budget dip" value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-3.5 rounded-2xl bg-[#2C2C2E] text-white text-[17px]
                         border border-white/8 outline-none placeholder:text-white/20" />
          </div>

          {error && <p className="text-[#FF453A] text-sm text-center">{error}</p>}

          <button type="submit" disabled={loading || !symbol || !qty || !price}
            className={`w-full py-4 rounded-2xl font-bold text-[17px] transition-all active:scale-[0.98]
              disabled:opacity-40 text-white
              ${done ? 'bg-white/20' : type === 'buy' ? 'bg-[#30D158]' : 'bg-[#FF453A]'}`}>
            {done ? '✓ Added' : loading ? '…' : `${type === 'buy' ? 'Buy' : 'Sell'} ${symbol}`}
          </button>
        </form>
      </div>
    </>
  )
}
