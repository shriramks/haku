'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { todayISO, formatINR, formatINRFull, formatPrice } from '@/lib/formatter'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'
import { SearchIcon, StockIcon, MFIcon, GoldIcon, PPFIcon, EPFIcon } from '@/components/icons'
import { upsertMFund, addMFTransaction, addGoldTransaction, addPPFTransaction, addEPFTransaction } from '@/app/portfolio/actions'

type AssetType = 'stock' | 'mf' | 'gold' | 'ppf' | 'epf'
type GoldType  = 'sgb' | 'etf' | 'physical'

const ASSET_TYPES = [
  { id: 'stock' as AssetType, label: 'Stocks',      Icon: StockIcon },
  { id: 'mf'    as AssetType, label: 'Mutual Fund', Icon: MFIcon    },
  { id: 'gold'  as AssetType, label: 'Gold',        Icon: GoldIcon  },
  { id: 'ppf'   as AssetType, label: 'PPF',         Icon: PPFIcon   },
  { id: 'epf'   as AssetType, label: 'EPF',         Icon: EPFIcon   },
] as const

export default function AddTxnModal({
  onClose,
  initialSymbol,
  planSymbols: planSymbolsProp,
}: {
  onClose: () => void
  initialSymbol?: string
  planSymbols?: string[]
}) {
  const router = useRouter()

  // ── Shared ─────────────────────────────────────────────────────────────────
  const [assetType, setAssetType]             = useState<AssetType>('stock')
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [date, setDate]                       = useState(todayISO())
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState<string | null>(null)
  const [done, setDone]                       = useState(false)
  const kh = useKeyboardHeight()

  // ── Stocks ─────────────────────────────────────────────────────────────────
  const [symbol, setSymbol]       = useState(initialSymbol ?? '')
  const [planSymbols, setPlanSymbols] = useState<string[]>(() => {
    if (planSymbolsProp && planSymbolsProp.length > 0) return planSymbolsProp
    try { const c = localStorage.getItem('haku_plan_symbols'); return c ? JSON.parse(c) : [] } catch { return [] }
  })
  const [txnType, setTxnType]     = useState<'buy' | 'sell'>('buy')
  const [qty, setQty]             = useState('')
  const [price, setPrice]         = useState('')
  const [redeploy, setRedeploy]   = useState(true)

  // ── MF ─────────────────────────────────────────────────────────────────────
  const [mfFund, setMFFund]             = useState<{ code: string; name: string; schemeType: string } | null>(null)
  const [mfQuery, setMFQuery]           = useState('')
  const [mfResults, setMFResults]       = useState<{ schemeCode: number; schemeName: string }[]>([])
  const [mfSearching, setMFSearching]   = useState(false)
  const [existingFunds, setExistingFunds] = useState<{ id: string; scheme_code: string; scheme_name: string; scheme_type: string }[]>([])
  const [mfUnits, setMFUnits]           = useState('')
  const [mfNav, setMFNav]               = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Gold ───────────────────────────────────────────────────────────────────
  const [goldType, setGoldType]   = useState<GoldType>('sgb')
  const [goldName, setGoldName]   = useState('')
  const [goldQty, setGoldQty]     = useState('')
  const [goldPrice, setGoldPrice] = useState('')

  // ── PPF ────────────────────────────────────────────────────────────────────
  const [ppfType, setPPFType]     = useState<'deposit' | 'withdrawal'>('deposit')
  const [ppfAmount, setPPFAmount] = useState('')

  // ── EPF ────────────────────────────────────────────────────────────────────
  const [epfAmount, setEPFAmount] = useState('')

  // ── Body scroll lock ───────────────────────────────────────────────────────
  useEffect(() => {
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    return () => {
      document.body.style.position = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }, [])

  // ── Plan symbols ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (planSymbolsProp && planSymbolsProp.length > 0) return
    async function loadSymbols() {
      const sb = getSupabaseBrowser()
      const { data } = await sb.from('stock_allocations').select('symbol').order('symbol')
      if (data) setPlanSymbols([...new Set(data.map(a => a.symbol))].sort())
    }
    loadSymbols()
  }, [planSymbolsProp])

  // ── Existing MF funds (fetched on mount for instant display when switching) ─
  useEffect(() => {
    async function loadFunds() {
      const sb = getSupabaseBrowser()
      const { data } = await sb.from('mf_funds').select('id, scheme_code, scheme_name, scheme_type').order('scheme_name')
      if (data) setExistingFunds(data)
    }
    loadFunds()
  }, [])

  // ── MF fund search ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (mfQuery.length < 2) { setMFResults([]); return }
    setMFSearching(true)
    clearTimeout(debounceRef.current ?? undefined)
    debounceRef.current = setTimeout(() => {
      fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(mfQuery)}`)
        .then(r => r.json())
        .then(d => { setMFResults((d as { schemeCode: number; schemeName: string }[]).slice(0, 6)); setMFSearching(false) })
        .catch(() => setMFSearching(false))
    }, 300)
  }, [mfQuery])

  // ── Derived amounts ────────────────────────────────────────────────────────
  const stockAmount = (parseFloat(qty) || 0) * (parseFloat(price) || 0)
  const mfAmount    = (parseFloat(mfUnits) || 0) * (parseFloat(mfNav) || 0)
  const goldAmount  = (parseFloat(goldQty) || 0) * (parseFloat(goldPrice) || 0)

  const heroAmount = assetType === 'stock' ? stockAmount
    : assetType === 'mf'   ? mfAmount
    : assetType === 'gold' ? goldAmount
    : assetType === 'ppf'  ? (parseFloat(ppfAmount) || 0)
    :                        (parseFloat(epfAmount) || 0)

  const heroColor = assetType === 'epf'  ? 'var(--accent)'
    : assetType === 'ppf'  ? (ppfType === 'deposit' ? '#34C759' : '#FF3B30')
    :                        (txnType === 'buy' ? '#34C759' : '#FF3B30')

  const goldMaturityDate = assetType === 'gold' && goldType === 'sgb' && txnType === 'buy' && date
    ? (() => { const d = new Date(date); d.setFullYear(d.getFullYear() + 8); return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) })()
    : null

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    let err: string | null = null

    if (assetType === 'stock') {
      if (!symbol || !qty || !price) { setLoading(false); return }
      const sb = getSupabaseBrowser()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { onClose(); return }

      const d = new Date(date)
      const fyEndYear = (d.getMonth() + 1) >= 4 ? d.getFullYear() + 1 : d.getFullYear()
      const { data: fyRows } = await sb
        .from('fiscal_years').select('id')
        .gte('start_date', `${fyEndYear - 1}-04-01`)
        .lte('end_date', `${fyEndYear}-03-31`)
        .limit(1)
      const fyId = fyRows?.[0]?.id ?? null
      const { error: txnErr } = await sb.from('transactions').insert({
        user_id: user.id, symbol, exchange: 'NSE',
        trade_date: date, trade_type: txnType,
        quantity: parseFloat(qty), price: parseFloat(price),
        fy_id: fyId,
      })
      if (!txnErr && txnType === 'sell' && redeploy && fyId) {
        const { data: fy } = await sb.from('fiscal_years')
          .select('unallocated_carryover_inr').eq('id', fyId).single()
        const current = fy?.unallocated_carryover_inr ?? 0
        await sb.from('fiscal_years')
          .update({ unallocated_carryover_inr: current + stockAmount })
          .eq('id', fyId)
      }
      err = txnErr?.message ?? null

    } else if (assetType === 'mf') {
      if (!mfFund || !mfUnits || !mfNav) { setLoading(false); return }
      const { fundId, error: fundErr } = await upsertMFund(mfFund.code, mfFund.name, mfFund.schemeType)
      if (fundErr || !fundId) { setError(fundErr ?? 'Failed to save fund'); setLoading(false); return }
      const { error: txnErr } = await addMFTransaction(fundId, date, txnType, parseFloat(mfUnits), parseFloat(mfNav))
      err = txnErr ?? null

    } else if (assetType === 'gold') {
      if (!goldQty || !goldPrice || (goldType === 'etf' && !goldName)) { setLoading(false); return }
      const { error: txnErr } = await addGoldTransaction(goldType, goldName || null, date, txnType, parseFloat(goldQty), parseFloat(goldPrice))
      err = txnErr ?? null

    } else if (assetType === 'ppf') {
      if (!ppfAmount) { setLoading(false); return }
      const { error: txnErr } = await addPPFTransaction(date, ppfType, parseFloat(ppfAmount))
      err = txnErr ?? null

    } else if (assetType === 'epf') {
      if (!epfAmount) { setLoading(false); return }
      const { error: txnErr } = await addEPFTransaction(date, 'deposit', parseFloat(epfAmount))
      err = txnErr ?? null
    }

    setLoading(false)
    if (err) { setError(err); return }
    setDone(true)
    setTimeout(() => { router.refresh(); onClose() }, 700)
  }

  const chipLabel = ASSET_TYPES.find(t => t.id === assetType)!.label

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />

      <div
        className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl flex flex-col overflow-hidden sheet-kb"
        style={{
          bottom: kh,
          background: 'var(--bg-secondary)',
          maxHeight: kh > 0
            ? `calc(100dvh - ${kh}px - max(env(safe-area-inset-top,0px), 16px))`
            : '92dvh',
        }}>

        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-1 pb-3 flex-shrink-0">
          <button onClick={onClose}
            className="text-accent text-headline font-semibold min-h-[44px] min-w-[44px] flex items-center">
            Cancel
          </button>
          <p className="font-semibold text-headline">New Transaction</p>
          <button
            type="button"
            onClick={() => setAssetPickerOpen(true)}
            className="flex items-center gap-1 text-body font-semibold text-accent min-h-[44px] px-1">
            {chipLabel}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-accent">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
        </div>

        {/* Asset type picker overlay */}
        {assetPickerOpen && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setAssetPickerOpen(false)} />
            <div className="fixed left-0 right-0 z-[60] animate-slide-up rounded-t-3xl"
                 style={{ bottom: kh, background: 'var(--bg-secondary)', paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
              </div>
              <p className="px-5 pt-1 pb-3 text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Asset type</p>
              {ASSET_TYPES.map(({ id, label, Icon }) => (
                <button key={id} type="button"
                  onClick={() => { setAssetType(id); setAssetPickerOpen(false); setError(null); setDone(false) }}
                  className="flex items-center w-full px-5 border-t"
                  style={{ minHeight: 56, borderColor: 'var(--divider)' }}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center mr-4 flex-shrink-0"
                       style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)' }}>
                    <Icon width="18" height="18" />
                  </div>
                  <span className="flex-1 text-left text-headline font-semibold">{label}</span>
                  {id === assetType && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ color: 'var(--accent)' }}>
                      <path d="M5 13l4 4L19 7"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Buy / Sell toggle — stock, mf, gold */}
        {(assetType === 'stock' || assetType === 'mf' || assetType === 'gold') && (
          <div className="px-4 flex-shrink-0">
            <div className="flex rounded-xl overflow-hidden" style={{ border: '1.5px solid var(--border)', height: 54 }}>
              {(['buy', 'sell'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTxnType(t)}
                  className="flex-1 text-headline font-bold transition-colors"
                  style={txnType === t
                    ? { background: t === 'buy' ? '#34C759' : '#FF3B30', color: '#fff' }
                    : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                  {t === 'buy' ? 'Buy' : 'Sell'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Deposit / Withdrawal toggle — ppf */}
        {assetType === 'ppf' && (
          <div className="px-4 flex-shrink-0">
            <div className="flex rounded-xl overflow-hidden" style={{ border: '1.5px solid var(--border)', height: 54 }}>
              {(['deposit', 'withdrawal'] as const).map(t => (
                <button key={t} type="button" onClick={() => setPPFType(t)}
                  className="flex-1 text-headline font-bold transition-colors"
                  style={ppfType === t
                    ? { background: t === 'deposit' ? '#34C759' : '#FF3B30', color: '#fff' }
                    : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                  {t === 'deposit' ? 'Deposit' : 'Withdrawal'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Amount hero */}
        <div className="flex flex-col items-center py-3 flex-shrink-0">
          {heroAmount > 0 ? (
            <>
              <p className="tabnum font-bold" style={{ fontSize: 30, letterSpacing: -0.5, color: heroColor }}>
                {formatINRFull(heroAmount)}
              </p>
              {assetType === 'stock' && (
                <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {qty} × {formatPrice(parseFloat(price) || 0)}
                </p>
              )}
              {assetType === 'mf' && (
                <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {mfUnits} units × ₹{mfNav}
                </p>
              )}
              {assetType === 'gold' && (
                <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {goldType === 'etf' ? `${goldQty} units × ₹${goldPrice}/unit` : `${goldQty}g × ₹${goldPrice}/g`}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="font-bold" style={{ fontSize: 34, letterSpacing: -0.5, color: 'var(--text-faint)' }}>₹ —</p>
              <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-faint)' }}>
                {assetType === 'stock' ? 'enter qty & price below'
                  : assetType === 'mf' ? 'enter units & NAV below'
                  : assetType === 'gold' ? `enter ${goldType === 'etf' ? 'units' : 'grams'} & price below`
                  : 'enter amount below'}
              </p>
            </>
          )}
        </div>

        <div className="flex-shrink-0" style={{ height: 1, background: 'var(--border-faint)', margin: '0 16px 14px' }} />

        {/* Scrollable form */}
        <div className="overflow-y-auto" style={{ paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
          <form onSubmit={submit} className="px-4 space-y-3">

            {/* ── STOCKS ─────────────────────────────────────────────────── */}
            {assetType === 'stock' && (
              <>
                <div>
                  <div className="flex items-baseline justify-between mb-2">
                    <p className="text-footnote uppercase" style={{ color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '0.07em' }}>Stock</p>
                    {symbol && (
                      <button type="button" onClick={() => setSymbol('')}
                        className="text-subheadline" style={{ color: 'var(--text-faint)' }}>clear</button>
                    )}
                  </div>
                  {planSymbols.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {planSymbols.map(s => (
                        <button key={s} type="button" onClick={() => setSymbol(s)}
                          className="px-3 rounded-xl text-body font-semibold transition-colors"
                          style={{
                            minHeight: 36,
                            ...(symbol === s
                              ? { background: txnType === 'buy' ? 'rgba(52,199,89,0.10)' : 'rgba(255,59,48,0.10)', color: txnType === 'buy' ? '#34C759' : '#FF3B30', border: `1.5px solid ${txnType === 'buy' ? '#34C759' : '#FF3B30'}` }
                              : { background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1.5px solid transparent' }),
                          }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>Loading plan…</p>
                  )}
                </div>

                <div>
                  <FieldLabel>Date</FieldLabel>
                  <DateInput value={date} onChange={setDate} />
                </div>

                <div className="grid grid-cols-2 rounded-2xl overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                  <TwoColCell label="Quantity" value={qty} onChange={setQty} placeholder="100" decimal={false} />
                  <TwoColCell label="Price ₹" value={price} onChange={setPrice} placeholder="1250.50" decimal right />
                </div>

                {txnType === 'sell' && stockAmount > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl"
                       style={{ background: 'rgba(255,59,48,0.06)', border: '1px solid rgba(255,59,48,0.15)', opacity: redeploy ? 1 : 0.6 }}>
                    <div className="flex-1 mr-3">
                      <p className="text-body font-medium">Redeploy proceeds</p>
                      <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {redeploy ? `Adds ${formatINR(stockAmount)} to this year's budget` : "Proceeds stay in this stock's allocation"}
                      </p>
                    </div>
                    <button type="button" onClick={() => setRedeploy(r => !r)}
                      className="relative flex-shrink-0" style={{ width: 51, height: 31 }}>
                      <div className={`absolute inset-0 rounded-full transition-colors duration-200 ${redeploy ? 'bg-positive' : 'bg-[#ccc]'}`} />
                      <div className="absolute top-0.5 rounded-full bg-white shadow transition-transform duration-200"
                           style={{ width: 27, height: 27, left: 2, transform: redeploy ? 'translateX(20px)' : 'translateX(0)' }} />
                    </button>
                  </div>
                )}

                {error && <p className="text-negative text-body text-center">{error}</p>}

                <button type="submit" disabled={loading || !symbol || !qty || !price}
                  className="w-full py-4 rounded-xl font-bold text-headline transition-all active:scale-[0.98] disabled:opacity-40 text-white"
                  style={{ background: done ? 'var(--border)' : (txnType === 'buy' ? '#34C759' : '#FF3B30') }}>
                  {done ? '✓ Added' : loading ? '…' : `${txnType === 'buy' ? 'Buy' : 'Sell'} ${symbol || '…'}`}
                </button>
              </>
            )}

            {/* ── MUTUAL FUND ─────────────────────────────────────────────── */}
            {assetType === 'mf' && (
              <>
                <div>
                  <FieldLabel>Fund</FieldLabel>
                  {mfFund ? (
                    <div className="flex items-center gap-3 px-3 py-3 rounded-xl" style={{ background: 'var(--bg-tertiary)' }}>
                      <p className="flex-1 text-body font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{mfFund.name}</p>
                      <button type="button" onClick={() => setMFFund(null)}
                        className="text-subheadline flex-shrink-0" style={{ color: 'var(--text-faint)' }}>Change</button>
                    </div>
                  ) : (
                    <>
                      {existingFunds.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {existingFunds.map(f => (
                            <button key={f.id} type="button"
                              onClick={() => { setMFFund({ code: f.scheme_code, name: f.scheme_name, schemeType: f.scheme_type }); setMFQuery('') }}
                              className="px-3 py-2 rounded-xl text-body font-medium"
                              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                              {f.scheme_name.split(' ').slice(0, 3).join(' ')}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="relative">
                        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />
                        <input type="text" placeholder="Search fund name…" value={mfQuery}
                          onChange={e => setMFQuery(e.target.value)}
                          className="w-full pl-9 pr-3 rounded-xl text-body outline-none"
                          style={{ height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                      </div>
                      {mfSearching && <p className="text-subheadline mt-2 px-1" style={{ color: 'var(--text-faint)' }}>Searching…</p>}
                      {mfResults.length > 0 && (
                        <div className="mt-1 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                          {mfResults.map(r => (
                            <button key={r.schemeCode} type="button"
                              onClick={() => { setMFFund({ code: String(r.schemeCode), name: r.schemeName, schemeType: '' }); setMFQuery(''); setMFResults([]) }}
                              className="flex items-center w-full px-3 py-3 text-left border-t first:border-t-0 text-subheadline"
                              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--divider)' }}>
                              {r.schemeName}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div>
                  <FieldLabel>Date</FieldLabel>
                  <DateInput value={date} onChange={setDate} />
                </div>

                <div>
                  <FieldLabel>Details</FieldLabel>
                  <div className="grid grid-cols-2 rounded-2xl overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                    <TwoColCell label="Units" value={mfUnits} onChange={setMFUnits} placeholder="124.589" decimal />
                    <TwoColCell label="NAV ₹" value={mfNav} onChange={setMFNav} placeholder="472.35" decimal right />
                  </div>
                </div>

                {error && <p className="text-negative text-subheadline text-center">{error}</p>}

                <button type="submit" disabled={loading || !mfFund || !mfUnits || !mfNav}
                  className="w-full py-4 rounded-xl font-bold text-headline active:scale-[0.98] disabled:opacity-40 text-white"
                  style={{ background: done ? 'var(--border)' : (txnType === 'buy' ? '#34C759' : '#FF3B30') }}>
                  {done ? '✓ Added' : loading ? '…' : txnType === 'buy' ? 'Buy' : 'Sell'}
                </button>
              </>
            )}

            {/* ── GOLD ────────────────────────────────────────────────────── */}
            {assetType === 'gold' && (
              <>
                <div className="flex gap-2">
                  {(['sgb', 'etf', 'physical'] as const).map(t => (
                    <button key={t} type="button" onClick={() => { setGoldType(t); setGoldName('') }}
                      className="flex-1 rounded-xl text-subheadline font-bold transition-colors"
                      style={{
                        height: 40,
                        background: goldType === t ? 'rgba(255,214,10,0.10)' : 'var(--bg-tertiary)',
                        border: goldType === t ? '1.5px solid rgba(255,214,10,0.40)' : '1.5px solid transparent',
                        color: goldType === t ? 'rgba(255,214,10,0.90)' : 'var(--text-muted)',
                      }}>
                      {t === 'sgb' ? 'SGB' : t === 'etf' ? 'ETF' : 'Physical'}
                    </button>
                  ))}
                </div>

                {goldType !== 'sgb' && (
                  <div>
                    <FieldLabel>{goldType === 'etf' ? 'Fund name' : 'Description (optional)'}</FieldLabel>
                    <input type="text" value={goldName} onChange={e => setGoldName(e.target.value)}
                      placeholder={goldType === 'etf' ? 'SBI Gold ETF' : 'e.g. 22K ring, hallmarked bar…'}
                      onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                      className="w-full px-3 py-2.5 rounded-xl text-body outline-none"
                      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                  </div>
                )}

                <div>
                  <FieldLabel>{txnType === 'buy' ? 'Purchase date' : 'Sale date'}</FieldLabel>
                  <DateInput value={date} onChange={setDate} />
                </div>

                <div>
                  <FieldLabel>Details</FieldLabel>
                  <div className="grid grid-cols-2 rounded-2xl overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                    <TwoColCell label={goldType === 'etf' ? 'Units' : 'Grams'}
                      value={goldQty} onChange={setGoldQty}
                      placeholder={goldType === 'etf' ? '50' : '20'} decimal />
                    <TwoColCell
                      label={goldType === 'etf' ? 'NAV ₹/unit' : (txnType === 'buy' ? 'Issue price ₹/g' : 'Sale price ₹/g')}
                      value={goldPrice} onChange={setGoldPrice} placeholder="9241" decimal right />
                  </div>
                </div>

                {goldMaturityDate && (
                  <div className="flex justify-between items-center px-3 py-3 rounded-xl"
                       style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-faint)' }}>
                    <span className="text-subheadline" style={{ color: 'var(--text-muted)' }}>Matures on</span>
                    <span className="text-body font-medium tabnum" style={{ color: 'var(--text-2)' }}>{goldMaturityDate}</span>
                  </div>
                )}

                {goldType === 'physical' && (
                  <p className="text-footnote" style={{ color: 'var(--text-faint)' }}>Valued at current 24K market rate</p>
                )}

                {error && <p className="text-negative text-subheadline text-center">{error}</p>}

                <button type="submit" disabled={loading || !goldQty || !goldPrice || (goldType === 'etf' && !goldName)}
                  className="w-full py-4 rounded-xl font-bold text-headline active:scale-[0.98] disabled:opacity-40 text-white"
                  style={{ background: done ? 'var(--border)' : (txnType === 'buy' ? '#34C759' : '#FF3B30') }}>
                  {done ? '✓ Added' : loading ? '…' : txnType === 'buy' ? 'Save Buy' : 'Save Sell'}
                </button>
              </>
            )}

            {/* ── PPF ─────────────────────────────────────────────────────── */}
            {assetType === 'ppf' && (
              <>
                <div>
                  <FieldLabel>Date</FieldLabel>
                  <DateInput value={date} onChange={setDate} />
                </div>
                <div>
                  <FieldLabel>Amount ₹</FieldLabel>
                  <input type="number" inputMode="numeric" placeholder="150000" value={ppfAmount}
                    onChange={e => setPPFAmount(e.target.value)} required min="1"
                    onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                    className="w-full px-3 rounded-xl text-headline font-bold tabnum outline-none"
                    style={{ height: 52, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                </div>
                {error && <p className="text-negative text-subheadline text-center">{error}</p>}
                <button type="submit" disabled={loading || !ppfAmount}
                  className="w-full py-4 rounded-xl font-bold text-headline active:scale-[0.98] disabled:opacity-40 text-white"
                  style={{ background: done ? 'var(--border)' : (ppfType === 'deposit' ? '#34C759' : '#FF3B30') }}>
                  {done ? '✓ Added' : loading ? '…' : ppfType === 'deposit' ? 'Save Deposit' : 'Save Withdrawal'}
                </button>
              </>
            )}

            {/* ── EPF ─────────────────────────────────────────────────────── */}
            {assetType === 'epf' && (
              <>
                <div>
                  <FieldLabel>Month</FieldLabel>
                  <DateInput value={date} onChange={setDate} />
                </div>
                <div>
                  <FieldLabel>Amount ₹</FieldLabel>
                  <input type="number" inputMode="numeric" placeholder="51550" value={epfAmount}
                    onChange={e => setEPFAmount(e.target.value)} required min="1"
                    onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                    className="w-full px-3 rounded-xl text-headline font-bold tabnum outline-none"
                    style={{ height: 52, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                </div>
                {error && <p className="text-negative text-subheadline text-center">{error}</p>}
                <button type="submit" disabled={loading || !epfAmount}
                  className="w-full py-4 rounded-xl font-bold text-headline active:scale-[0.98] disabled:opacity-40 text-white"
                  style={{ background: done ? 'var(--border)' : 'var(--accent)' }}>
                  {done ? '✓ Added' : loading ? '…' : 'Save Deposit'}
                </button>
              </>
            )}

          </form>
        </div>
      </div>
    </>
  )
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-footnote mb-1.5 uppercase"
       style={{ color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '0.07em' }}>
      {children}
    </p>
  )
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input type="date" value={value} onChange={e => onChange(e.target.value)} required
      onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
      className="w-full px-3 py-2.5 rounded-xl text-body outline-none max-w-full"
      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark', boxSizing: 'border-box' }} />
  )
}

function TwoColCell({ label, value, onChange, placeholder, decimal, right }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder: string; decimal: boolean; right?: boolean
}) {
  return (
    <div className="p-3" style={right ? { borderLeft: '1px solid var(--border)' } : {}}>
      <p className="text-footnote uppercase mb-1"
         style={{ fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-faint)' }}>{label}</p>
      <input
        type="number" inputMode={decimal ? 'decimal' : 'numeric'}
        placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        min={decimal ? '0.001' : '1'} step={decimal ? 'any' : '1'}
        onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
        className="w-full bg-transparent tabnum font-bold outline-none"
        style={{ fontSize: 22, color: 'var(--text-primary)', textAlign: right ? 'right' : 'left' }}
      />
    </div>
  )
}
