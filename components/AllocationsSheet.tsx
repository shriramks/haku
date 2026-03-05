'use client'
import { useState, useEffect } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatPct } from '@/lib/formatter'
import { DEFAULT_CATEGORY, type StockAllocation, type FiscalYear, type StockCategory } from '@/lib/types'

const ALL_CATEGORIES: StockCategory[] = [
  'Capital-light Market Infra/Services', 'Retail', 'Defence', 'Insurance',
  'Electricals/Capital Goods', 'Asset-heavy Infra/Platforms',
  'Hospitals', 'FMCG', 'Auto OEM', 'Pharma',
]

interface Props {
  fy: FiscalYear | null
  onClose: () => void
}

export default function AllocationsSheet({ fy, onClose }: Props) {
  const [allocations, setAllocations] = useState<StockAllocation[]>([])
  const [loading, setLoading]         = useState(true)
  const [showAdd, setShowAdd]         = useState(false)

  useEffect(() => {
    if (!fy) { setLoading(false); return }
    getSupabaseBrowser()
      .from('stock_allocations').select('*')
      .eq('fy_id', fy.id).order('allocation_pct', { ascending: false })
      .then(({ data }) => { setAllocations(data ?? []); setLoading(false) })
  }, [fy])

  async function saveAlloc(updated: StockAllocation) {
    await getSupabaseBrowser().from('stock_allocations').upsert(updated)
    setAllocations(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  async function deleteAlloc(id: string) {
    await getSupabaseBrowser().from('stock_allocations').delete().eq('id', id)
    setAllocations(prev => prev.filter(a => a.id !== id))
  }

  async function addAlloc(symbol: string, pct: number, category: StockCategory) {
    if (!fy) return
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const { data } = await sb.from('stock_allocations').insert({
      fy_id: fy.id, user_id: user.id,
      symbol: symbol.toUpperCase(), exchange: 'NSE',
      allocation_pct: pct, category,
      two_weak_quarters: false, is_hospital_ramp_phase: false,
    }).select().single()
    if (data) setAllocations(prev => [...prev, data].sort((a, b) => b.allocation_pct - a.allocation_pct))
    setShowAdd(false)
  }

  const totalPct = allocations.reduce((s, a) => s + a.allocation_pct, 0)
  const remaining = 100 - totalPct

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up
                      bg-[#1C1C1E] rounded-t-[28px] max-h-[92vh] flex flex-col
                      pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-9 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-1 pb-3 flex-shrink-0 border-b border-white/8">
          <button onClick={onClose} className="text-[#0A84FF] text-[17px]">Done</button>
          <div className="text-center">
            <p className="font-semibold text-[17px]">Allocations</p>
            {fy && <p className="text-[12px] text-white/40">{fy.label}</p>}
          </div>
          <button onClick={() => setShowAdd(v => !v)}
            className="text-[#0A84FF] text-[17px]">
            {showAdd ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {/* Total bar */}
        <div className="px-5 py-3 flex-shrink-0">
          <div className="flex justify-between text-[13px] mb-1.5">
            <span className="text-white/50">Allocated</span>
            <span className={`tabnum font-semibold ${
              totalPct > 100 ? 'text-[#FF453A]' : totalPct === 100 ? 'text-[#30D158]' : 'text-white/70'
            }`}>{formatPct(totalPct)} · {remaining >= 0 ? formatPct(remaining) + ' free' : 'over by ' + formatPct(-remaining)}</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${
              totalPct > 100 ? 'bg-[#FF453A]' : totalPct === 100 ? 'bg-[#30D158]' : 'bg-[#0A84FF]'
            }`} style={{ width: `${Math.min(100, totalPct)}%` }} />
          </div>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="px-4 pb-3 flex-shrink-0 border-b border-white/8">
            <AddAllocForm onAdd={addAlloc} />
          </div>
        )}

        {/* List */}
        <div className="overflow-y-auto flex-1 px-4 py-2 space-y-2">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
          ) : allocations.length === 0 ? (
            <div className="text-center py-12 text-white/30">
              <p>No allocations yet</p>
              <p className="text-sm mt-1">Tap + Add to create one</p>
            </div>
          ) : (
            allocations.map(alloc => (
              <AllocRow key={alloc.id} alloc={alloc} onSave={saveAlloc} onDelete={deleteAlloc} />
            ))
          )}
        </div>
      </div>
    </>
  )
}

// ── Allocation row ────────────────────────────────────────────────────────────

function AllocRow({ alloc, onSave, onDelete }: {
  alloc: StockAllocation
  onSave: (a: StockAllocation) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [pct, setPct]         = useState(alloc.allocation_pct.toString())
  const [category, setCategory] = useState(alloc.category)
  const [twoWeak, setTwoWeak] = useState(alloc.two_weak_quarters)
  const [ramp, setRamp]       = useState(alloc.is_hospital_ramp_phase)
  const [saving, setSaving]   = useState(false)
  const [expanded, setExpanded] = useState(false)

  async function save() {
    setSaving(true)
    await onSave({ ...alloc, allocation_pct: parseFloat(pct) || alloc.allocation_pct, category, two_weak_quarters: twoWeak, is_hospital_ramp_phase: ramp })
    setSaving(false)
  }

  return (
    <div className="rounded-2xl bg-[#2C2C2E] overflow-hidden">
      {/* Main row */}
      <button onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
        <span className="font-bold text-[16px] flex-1">{alloc.symbol}</span>
        <span className="text-white/40 text-[13px]">{alloc.category.split('/')[0]}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number" inputMode="decimal" value={pct}
            onChange={e => { e.stopPropagation(); setPct(e.target.value) }}
            onClick={e => e.stopPropagation()}
            className="w-14 px-2 py-1 rounded-lg bg-white/10 text-white text-[15px] tabnum text-right
                       border border-white/10 outline-none"
          />
          <span className="text-white/40 text-[15px]">%</span>
        </div>
        <span className={`text-white/40 text-[12px] transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {/* Expanded options */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/8 pt-3">
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 text-white/70 text-[14px]
                       border border-white/10 outline-none">
            {ALL_CATEGORIES.map(c => (
              <option key={c} value={c} className="bg-[#1C1C1E]">{c}</option>
            ))}
          </select>

          <div className="flex gap-4 text-[13px] text-white/50">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={twoWeak} onChange={e => setTwoWeak(e.target.checked)}
                className="w-4 h-4 rounded accent-[#FF9F0A]" />
              2 Weak Quarters
            </label>
            {category === 'Hospitals' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={ramp} onChange={e => setRamp(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#0A84FF]" />
                Ramp Phase
              </label>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-[#0A84FF]/20 text-[#0A84FF] text-[15px]
                         font-semibold disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => onDelete(alloc.id)}
              className="px-4 py-2.5 rounded-xl bg-[#FF453A]/10 text-[#FF453A] text-[15px]">
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add allocation form ───────────────────────────────────────────────────────

function AddAllocForm({ onAdd }: {
  onAdd: (symbol: string, pct: number, category: StockCategory) => Promise<void>
}) {
  const [symbol, setSymbol]   = useState('')
  const [pct, setPct]         = useState('')
  const [category, setCategory] = useState<StockCategory>('Capital-light Market Infra/Services')
  const [saving, setSaving]   = useState(false)

  async function submit() {
    if (!symbol || !pct) return
    setSaving(true)
    await onAdd(symbol.toUpperCase(), parseFloat(pct), category)
    setSaving(false)
  }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Symbol (INFY)" value={symbol}
          onChange={e => {
            const s = e.target.value.toUpperCase()
            setSymbol(s)
            if (DEFAULT_CATEGORY[s]) setCategory(DEFAULT_CATEGORY[s])
          }}
          className="px-3 py-3 rounded-2xl bg-[#2C2C2E] text-white text-[15px]
                     border border-white/8 outline-none uppercase placeholder:normal-case placeholder:text-white/25" />
        <div className="flex items-center gap-1.5">
          <input type="number" inputMode="decimal" placeholder="%" value={pct}
            onChange={e => setPct(e.target.value)}
            className="flex-1 px-3 py-3 rounded-2xl bg-[#2C2C2E] text-white text-[15px] tabnum
                       border border-white/8 outline-none" />
          <span className="text-white/40">%</span>
        </div>
      </div>
      <select value={category} onChange={e => setCategory(e.target.value as StockCategory)}
        className="w-full px-3 py-2.5 rounded-xl bg-[#2C2C2E] text-white/60 text-[13px]
                   border border-white/8 outline-none">
        {ALL_CATEGORIES.map(c => <option key={c} value={c} className="bg-[#1C1C1E]">{c}</option>)}
      </select>
      <button onClick={submit} disabled={saving || !symbol || !pct}
        className="w-full py-3 rounded-2xl bg-white text-black font-bold text-[15px] disabled:opacity-30">
        {saving ? 'Adding…' : 'Add Stock'}
      </button>
    </div>
  )
}
