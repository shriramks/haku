'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINR, formatPct } from '@/lib/formatter'
import { DEFAULT_CATEGORY, type StockCategory } from '@/lib/types'
import type { FiscalYear, StockAllocation } from '@/lib/types'

interface Props {
  fiscalYears: FiscalYear[]
  initialAllocations: StockAllocation[]
  userEmail: string
}

const ALL_CATEGORIES: StockCategory[] = [
  'Capital-light Market Infra/Services', 'Retail', 'Defence', 'Insurance',
  'Electricals/Capital Goods', 'Asset-heavy Infra/Platforms', 'Hospitals',
  'FMCG', 'Auto OEM', 'Pharma',
]

export default function SettingsClient({ fiscalYears, initialAllocations, userEmail }: Props) {
  const router = useRouter()
  const [allocations, setAllocations] = useState(initialAllocations)
  const [saving, setSaving]           = useState(false)
  const [showAddFY, setShowAddFY]     = useState(false)
  const [showAddStock, setShowAddStock] = useState(false)
  const [selectedFY, setSelectedFY]   = useState(fiscalYears[0])

  async function signOut() {
    await getSupabaseBrowser().auth.signOut()
    router.push('/login')
  }

  async function saveAllocation(alloc: StockAllocation) {
    const sb = getSupabaseBrowser()
    await sb.from('stock_allocations').upsert(alloc)
    router.refresh()
  }

  async function deleteAllocation(id: string) {
    await getSupabaseBrowser().from('stock_allocations').delete().eq('id', id)
    setAllocations(a => a.filter(x => x.id !== id))
  }

  const totalPct = allocations.reduce((s, a) => s + a.allocation_pct, 0)

  return (
    <div className="pt-[env(safe-area-inset-top,0px)]">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/10">
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      <div className="px-4 py-4 space-y-6">
        {/* FY section */}
        <Section title="Fiscal Years">
          {fiscalYears.map(fy => (
            <Row key={fy.id} label={fy.label} value={formatINR(fy.total_budget_inr)}
                 sub={`${new Date(fy.start_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} – ${new Date(fy.end_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`} />
          ))}
          <button onClick={() => setShowAddFY(v => !v)}
            className="w-full py-2.5 rounded-xl border border-dashed border-white/20 text-white/40 text-sm">
            + Add Fiscal Year
          </button>
          {showAddFY && <AddFYForm onDone={() => { setShowAddFY(false); router.refresh() }} />}
        </Section>

        {/* Allocations */}
        <Section title={`Allocations · ${formatPct(totalPct)} allocated`}>
          <div className={`text-xs mb-2 ${totalPct > 100 ? 'text-red-400' : totalPct === 100 ? 'text-green-400' : 'text-white/40'}`}>
            Remaining: {formatPct(100 - totalPct)}
          </div>
          {allocations.map(alloc => (
            <AllocationRow key={alloc.id} alloc={alloc} onSave={saveAllocation} onDelete={deleteAllocation} />
          ))}
          <button onClick={() => setShowAddStock(v => !v)}
            className="w-full py-2.5 rounded-xl border border-dashed border-white/20 text-white/40 text-sm">
            + Add Stock
          </button>
          {showAddStock && selectedFY && (
            <AddStockForm fyId={selectedFY.id} userId={''} onDone={() => { setShowAddStock(false); router.refresh() }} />
          )}
        </Section>

        {/* Account */}
        <Section title="Account">
          <Row label="Email" value={userEmail} />
          <button onClick={signOut}
            className="w-full py-3 rounded-xl bg-red-500/10 text-red-400 text-sm font-medium border border-red-500/20">
            Sign Out
          </button>
        </Section>
      </div>
    </div>
  )
}

// ── Small components ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-white/30 uppercase tracking-widest mb-2">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-xs text-white/40">{sub}</p>}
      </div>
      <span className="text-sm text-white/60 tabnum">{value}</span>
    </div>
  )
}

function AllocationRow({ alloc, onSave, onDelete }: {
  alloc: StockAllocation
  onSave: (a: StockAllocation) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [pct, setPct]         = useState(alloc.allocation_pct.toString())
  const [category, setCategory] = useState(alloc.category)
  const [twoWeak, setTwoWeak] = useState(alloc.two_weak_quarters)
  const [ramp, setRamp]       = useState(alloc.is_hospital_ramp_phase)
  const [saving, setSaving]   = useState(false)

  async function save() {
    setSaving(true)
    await onSave({ ...alloc, allocation_pct: parseFloat(pct) || alloc.allocation_pct, category, two_weak_quarters: twoWeak, is_hospital_ramp_phase: ramp })
    setSaving(false)
  }

  return (
    <div className="p-3 rounded-xl bg-white/5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-bold text-sm flex-1">{alloc.symbol}</span>
        <input type="number" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)}
          className="w-16 px-2 py-1 rounded bg-white/10 text-white text-sm tabnum text-right border border-white/10 outline-none" />
        <span className="text-white/40 text-sm">%</span>
        <button onClick={() => onDelete(alloc.id)} className="text-white/20 text-lg px-1">×</button>
      </div>
      <select value={category} onChange={e => setCategory(e.target.value)}
        className="w-full px-2 py-1.5 rounded bg-white/5 text-white/60 text-xs border border-white/10 outline-none">
        {ALL_CATEGORIES.map(c => <option key={c} value={c} className="bg-black">{c}</option>)}
      </select>
      <div className="flex gap-4 text-xs text-white/50">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={twoWeak} onChange={e => setTwoWeak(e.target.checked)} className="accent-orange-500" />
          2 Weak Qtrs
        </label>
        {category === 'Hospitals' && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={ramp} onChange={e => setRamp(e.target.checked)} className="accent-blue-500" />
            Ramp Phase
          </label>
        )}
      </div>
      <button onClick={save} disabled={saving}
        className="w-full py-1.5 rounded-lg bg-white/10 text-white/60 text-xs disabled:opacity-40">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

function AddFYForm({ onDone }: { onDone: () => void }) {
  const [label, setLabel]   = useState('')
  const [start, setStart]   = useState('')
  const [end, setEnd]       = useState('')
  const [budget, setBudget] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!label || !start || !end || !budget) return
    setSaving(true)
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    await sb.from('fiscal_years').insert({
      user_id: user.id, label, start_date: start, end_date: end,
      total_budget_inr: parseFloat(budget),
    })
    setSaving(false)
    onDone()
  }

  return (
    <div className="p-3 rounded-xl bg-white/5 space-y-2">
      <input placeholder="Label (FY26)" value={label} onChange={e => setLabel(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/10 outline-none" />
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={start} onChange={e => setStart(e.target.value)}
          className="px-2 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/10 outline-none [color-scheme:dark]" />
        <input type="date" value={end} onChange={e => setEnd(e.target.value)}
          className="px-2 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/10 outline-none [color-scheme:dark]" />
      </div>
      <input type="number" inputMode="numeric" placeholder="Total budget (₹)" value={budget} onChange={e => setBudget(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white/10 text-white text-sm tabnum border border-white/10 outline-none" />
      <button onClick={save} disabled={saving}
        className="w-full py-2 rounded-xl bg-white text-black font-bold text-sm disabled:opacity-40">
        {saving ? 'Adding…' : 'Add FY'}
      </button>
    </div>
  )
}

function AddStockForm({ fyId, userId, onDone }: { fyId: string; userId: string; onDone: () => void }) {
  const [symbol, setSymbol]   = useState('')
  const [pct, setPct]         = useState('')
  const [category, setCategory] = useState<StockCategory>('Capital-light Market Infra/Services')
  const [saving, setSaving]   = useState(false)

  async function save() {
    if (!symbol || !pct) return
    setSaving(true)
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    await sb.from('stock_allocations').insert({
      fy_id: fyId, user_id: user.id,
      symbol: symbol.toUpperCase(), exchange: 'NSE',
      allocation_pct: parseFloat(pct), category,
      two_weak_quarters: false, is_hospital_ramp_phase: false,
    })
    setSaving(false)
    onDone()
  }

  return (
    <div className="p-3 rounded-xl bg-white/5 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Symbol (INFY)" value={symbol}
          onChange={e => { setSymbol(e.target.value.toUpperCase()); setCategory(DEFAULT_CATEGORY[e.target.value.toUpperCase()] ?? 'Capital-light Market Infra/Services') }}
          className="px-3 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/10 outline-none" />
        <div className="flex items-center gap-1">
          <input type="number" inputMode="decimal" placeholder="%" value={pct} onChange={e => setPct(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-white/10 text-white text-sm tabnum border border-white/10 outline-none" />
          <span className="text-white/40 text-sm">%</span>
        </div>
      </div>
      <select value={category} onChange={e => setCategory(e.target.value as StockCategory)}
        className="w-full px-2 py-2 rounded-lg bg-white/5 text-white/60 text-xs border border-white/10 outline-none">
        {ALL_CATEGORIES.map(c => <option key={c} value={c} className="bg-black">{c}</option>)}
      </select>
      <button onClick={save} disabled={saving}
        className="w-full py-2 rounded-xl bg-white text-black font-bold text-sm disabled:opacity-40">
        {saving ? 'Adding…' : 'Add Stock'}
      </button>
    </div>
  )
}
