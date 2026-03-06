'use client'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINR, formatPct } from '@/lib/formatter'
import { DEFAULT_CATEGORY, ALL_CATEGORIES, type FiscalYear, type StockAllocation, type StockCategory, type Playbook } from '@/lib/types'

const PLAYBOOK_PLACEHOLDER = `Paste or type your investment playbook here.

This is your personal reference — the rules and criteria you use when planning investments.
It's private and only visible to you.`

interface Props {
  fiscalYears: FiscalYear[]
  initialFY: FiscalYear | null
  initialAllocations: StockAllocation[]
  initialPlaybook: Playbook | null
}

type Tab = 'plan' | 'playbook'

export default function PlanClient({ fiscalYears, initialFY, initialAllocations, initialPlaybook }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('plan')
  const [selectedFY, setSelectedFY] = useState(initialFY)
  const [allocations, setAllocations] = useState(initialAllocations)
  const [loading, setLoading] = useState(false)
  const [showNewPlan, setShowNewPlan] = useState(false)

  async function switchFY(fy: FiscalYear) {
    setSelectedFY(fy)
    setLoading(true)
    const { data } = await getSupabaseBrowser()
      .from('stock_allocations').select('*')
      .eq('fy_id', fy.id).order('allocation_pct', { ascending: false })
    setAllocations(data ?? [])
    setLoading(false)
  }

  const totalPct = useMemo(() => allocations.reduce((s, a) => s + a.allocation_pct, 0), [allocations])
  const totalBudget = selectedFY?.total_budget_inr ?? 0

  return (
    <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b"
        style={{ background: 'var(--bg-nav)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h1 className="text-[28px] font-bold">Plan</h1>
          {tab === 'plan' && (
            <button
              onClick={() => setShowNewPlan(true)}
              className="px-3 py-1.5 rounded-xl text-[14px] font-semibold"
              style={{
                color: '#0A84FF',
                border: '1.5px solid #0A84FF',
                background: 'transparent',
              }}>
              + New Plan
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex px-4 pb-0 gap-4 border-b" style={{ borderColor: 'var(--border)' }}>
          {(['plan', 'playbook'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="pb-2.5 text-[15px] font-medium capitalize border-b-2 -mb-px transition-colors"
              style={{
                borderColor: tab === t ? '#0A84FF' : 'transparent',
                color: tab === t ? '#0A84FF' : 'var(--text-muted)',
              }}>
              {t === 'plan' ? 'FY Plan' : 'Playbook'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'plan' ? (
        <PlanTab
          fiscalYears={fiscalYears}
          selectedFY={selectedFY}
          allocations={allocations}
          loading={loading}
          totalPct={totalPct}
          totalBudget={totalBudget}
          onSwitchFY={switchFY}
          onAllocationsChange={setAllocations}
          onFYBudgetChange={(budget) => {
            if (selectedFY) setSelectedFY({ ...selectedFY, total_budget_inr: budget })
          }}
        />
      ) : (
        <PlaybookTab initialPlaybook={initialPlaybook} />
      )}

      {/* New Plan Sheet */}
      {showNewPlan && (
        <NewPlanSheet
          existingFYs={fiscalYears}
          latestAllocations={allocations}
          onClose={() => setShowNewPlan(false)}
          onCreate={(fy, allocs) => {
            setShowNewPlan(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ── Plan Tab ──────────────────────────────────────────────────────────────────

function PlanTab({
  fiscalYears, selectedFY, allocations, loading, totalPct, totalBudget,
  onSwitchFY, onAllocationsChange, onFYBudgetChange,
}: {
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
  allocations: StockAllocation[]
  loading: boolean
  totalPct: number
  totalBudget: number
  onSwitchFY: (fy: FiscalYear) => void
  onAllocationsChange: (allocs: StockAllocation[]) => void
  onFYBudgetChange: (budget: number) => void
}) {
  const [editBudget, setEditBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState(String(totalBudget))
  const [savingBudget, setSavingBudget] = useState(false)
  const [showAddStock, setShowAddStock] = useState(false)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)

  async function saveBudget() {
    if (!selectedFY) return
    const val = parseFloat(budgetInput)
    if (!val || val <= 0) return
    setSavingBudget(true)
    await getSupabaseBrowser().from('fiscal_years').update({ total_budget_inr: val }).eq('id', selectedFY.id)
    onFYBudgetChange(val)
    setSavingBudget(false)
    setEditBudget(false)
  }

  async function updateAllocPct(alloc: StockAllocation, pct: number) {
    await getSupabaseBrowser().from('stock_allocations').update({ allocation_pct: pct }).eq('id', alloc.id)
    onAllocationsChange(allocations.map(a => a.id === alloc.id ? { ...a, allocation_pct: pct } : a))
  }

  async function updateAllocCategory(alloc: StockAllocation, category: StockCategory) {
    await getSupabaseBrowser().from('stock_allocations').update({ category }).eq('id', alloc.id)
    onAllocationsChange(allocations.map(a => a.id === alloc.id ? { ...a, category } : a))
  }

  async function removeAlloc(id: string) {
    await getSupabaseBrowser().from('stock_allocations').delete().eq('id', id)
    onAllocationsChange(allocations.filter(a => a.id !== id))
  }

  async function addStock(symbol: string, category: StockCategory, pct: number) {
    if (!selectedFY) return
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const { data } = await sb.from('stock_allocations').insert({
      fy_id: selectedFY.id, user_id: user.id,
      symbol: symbol.toUpperCase(), exchange: 'NSE',
      allocation_pct: pct, category,
      two_weak_quarters: false, two_strong_quarters: false, is_hospital_ramp_phase: false,
    }).select().single()
    if (data) onAllocationsChange([...allocations, data].sort((a, b) => b.allocation_pct - a.allocation_pct))
    setShowAddStock(false)
  }

  async function refreshAllCMPs() {
    setRefreshingAll(true)
    await Promise.all(allocations.map(async a => {
      try {
        const res = await fetch(`/api/cmp/${a.symbol}`)
        if (!res.ok) return
        const { price } = await res.json()
        const sb = getSupabaseBrowser()
        await sb.from('buy_bands')
          .update({ manual_cmp: price, last_updated_at: new Date().toISOString() })
          .eq('symbol', a.symbol).eq('is_current', true)
      } catch {}
    }))
    setRefreshingAll(false)
  }

  async function generateAllBands() {
    setGeneratingAll(true)
    await Promise.all(allocations.map(async a => {
      try {
        await fetch(`/api/bands/generate/${a.symbol}`, { method: 'POST' })
      } catch {}
    }))
    setGeneratingAll(false)
  }

  const pctOk = Math.abs(totalPct - 100) < 0.01

  return (
    <div className="pb-6">
      {/* FY selector */}
      {fiscalYears.length > 1 && (
        <div className="flex gap-2 px-4 pt-4">
          {fiscalYears.map(fy => (
            <button key={fy.id} onClick={() => onSwitchFY(fy)}
              className="px-3 py-1.5 rounded-xl text-sm font-medium transition-colors"
              style={{
                background: selectedFY?.id === fy.id ? 'var(--text-primary)' : 'var(--border)',
                color: selectedFY?.id === fy.id ? 'var(--bg-primary)' : 'var(--text-muted)',
              }}>
              {fy.label}
            </button>
          ))}
        </div>
      )}

      {selectedFY ? (
        <>
          {/* Budget card */}
          <div className="mx-4 mt-4 p-4 rounded-2xl border"
               style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[12px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                  {selectedFY.label} Budget
                </p>
                {editBudget ? (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[17px]" style={{ color: 'var(--text-muted)' }}>₹</span>
                    <input
                      type="number" inputMode="decimal"
                      value={budgetInput}
                      onChange={e => setBudgetInput(e.target.value)}
                      className="text-[22px] font-bold w-36 tabnum outline-none rounded-lg px-2 py-0.5"
                      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                      autoFocus
                    />
                  </div>
                ) : (
                  <p className="text-[22px] font-bold tabnum mt-0.5">{formatINR(totalBudget)}</p>
                )}
              </div>
              {editBudget ? (
                <div className="flex gap-2">
                  <button onClick={() => setEditBudget(false)}
                    className="px-3 py-1.5 rounded-xl text-[14px]"
                    style={{ color: 'var(--text-muted)', background: 'var(--border)' }}>
                    Cancel
                  </button>
                  <button onClick={saveBudget} disabled={savingBudget}
                    className="px-3 py-1.5 rounded-xl text-[14px] font-semibold text-[#0A84FF] disabled:opacity-40"
                    style={{ background: 'rgba(10,132,255,0.15)' }}>
                    {savingBudget ? 'Saving…' : 'Save'}
                  </button>
                </div>
              ) : (
                <button onClick={() => { setBudgetInput(String(totalBudget)); setEditBudget(true) }}
                  className="px-3 py-1.5 rounded-xl text-[14px]"
                  style={{ color: 'var(--text-muted)', background: 'var(--border)' }}>
                  Edit
                </button>
              )}
            </div>

            {/* Allocation bar */}
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, totalPct)}%`,
                  background: totalPct > 100 ? '#FF3B30' : pctOk ? '#34C759' : '#0A84FF',
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[12px] tabnum"
                 style={{ color: 'var(--text-muted)' }}>
              <span>{allocations.length} stocks</span>
              <span className={totalPct > 100 ? 'text-red-400' : pctOk ? 'text-green-500' : ''}>
                {formatPct(totalPct)} allocated
                {!pctOk && totalPct <= 100 && ` · ${formatPct(100 - totalPct)} free`}
                {totalPct > 100 && ` · over by ${formatPct(totalPct - 100)}`}
                {pctOk && ' ✓'}
              </span>
            </div>
          </div>

          {/* Actions row */}
          <div className="flex justify-end gap-2 px-4 mt-3 flex-wrap">
            <button onClick={generateAllBands} disabled={generatingAll || refreshingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] font-medium disabled:opacity-50"
              style={{ background: 'rgba(10,132,255,0.12)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.3)' }}>
              <SparkleIcon className={`w-3.5 h-3.5 ${generatingAll ? 'spin' : ''}`} />
              {generatingAll ? 'Generating…' : 'Generate All Bands'}
            </button>
            <button onClick={refreshAllCMPs} disabled={refreshingAll || generatingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] font-medium disabled:opacity-50"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
              <RefreshIcon className={`w-3.5 h-3.5 ${refreshingAll ? 'spin' : ''}`} />
              Refresh All CMPs
            </button>
          </div>

          {/* Stock list */}
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 rounded-full"
                   style={{ borderColor: 'var(--border)', borderTopColor: 'var(--text-primary)',
                            animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : (
            <div className="px-4 mt-3 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[12px] uppercase tracking-widest font-semibold"
                   style={{ color: 'var(--text-muted)' }}>Stocks</p>
                <button onClick={() => setShowAddStock(v => !v)}
                  className="text-[#0A84FF] text-[14px]">
                  {showAddStock ? 'Cancel' : '+ Add Stock'}
                </button>
              </div>

              {showAddStock && (
                <AddStockForm onAdd={addStock} />
              )}

              {[...allocations].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(alloc => (
                <StockAllocRow
                  key={alloc.id}
                  alloc={alloc}
                  totalBudget={totalBudget}
                  onPctChange={updateAllocPct}
                  onCategoryChange={updateAllocCategory}
                  onRemove={removeAlloc}
                />
              ))}

              {allocations.length === 0 && !showAddStock && (
                <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                  <p className="text-[17px] font-medium mb-1">No stocks in this plan</p>
                  <p className="text-[15px]">Tap + Add Stock to get started</p>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-20 px-6" style={{ color: 'var(--text-muted)' }}>
          <p className="text-[17px] font-medium mb-2">No plan yet</p>
          <p className="text-[15px] mb-4">Create a plan to start allocating your investments for the year.</p>
        </div>
      )}
    </div>
  )
}

// ── Stock allocation row ──────────────────────────────────────────────────────

function StockAllocRow({ alloc, totalBudget, onPctChange, onCategoryChange, onRemove }: {
  alloc: StockAllocation
  totalBudget: number
  onPctChange: (a: StockAllocation, pct: number) => void
  onCategoryChange: (a: StockAllocation, cat: StockCategory) => void
  onRemove: (id: string) => void
}) {
  const [pct, setPct] = useState(alloc.allocation_pct.toString())
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const budget = (alloc.allocation_pct / 100) * totalBudget

  if (confirming) {
    return (
      <div className="flex items-center justify-between px-4 py-3.5 rounded-2xl border"
           style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <p className="text-[15px]" style={{ color: 'var(--text-2)' }}>Remove {alloc.symbol}?</p>
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Transactions kept</p>
        <div className="flex gap-4">
          <button onClick={() => setConfirming(false)} className="text-[#0A84FF] text-[15px]">Keep</button>
          <button onClick={() => onRemove(alloc.id)} className="text-red-400 text-[15px] font-semibold">Remove</button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl overflow-hidden border"
         style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button onClick={() => setExpanded(v => !v)} className="flex-1 flex items-center gap-3 text-left">
          <div className="flex-1">
            <p className="font-bold text-[16px]">{alloc.symbol}</p>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {alloc.category.split('/')[0]} · {formatINR(budget)}
            </p>
          </div>
        </button>

        {/* Pct input */}
        <div className="flex items-center gap-1">
          <input
            type="number" inputMode="decimal" value={pct}
            onChange={e => setPct(e.target.value)}
            onBlur={() => {
              const val = parseFloat(pct)
              if (val > 0 && val !== alloc.allocation_pct) onPctChange(alloc, val)
            }}
            className="w-14 px-2 py-1.5 rounded-xl text-[15px] tabnum text-right outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
          <span className="text-[15px]" style={{ color: 'var(--text-muted)' }}>%</span>
        </div>

        <button onClick={() => setExpanded(v => !v)} style={{ color: 'var(--text-faint)' }}>
          <ChevronIcon className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t space-y-3" style={{ borderColor: 'var(--border-faint)' }}>
          <div className="pt-3">
            <p className="text-[12px] mb-1.5" style={{ color: 'var(--text-muted)' }}>Category</p>
            <select
              value={alloc.category}
              onChange={e => onCategoryChange(alloc, e.target.value as StockCategory)}
              className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
              style={{
                background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}>
              {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <button onClick={() => setConfirming(true)}
            className="w-full py-2.5 rounded-xl text-[15px] text-red-400"
            style={{ background: 'rgba(255,59,48,0.10)' }}>
            Remove from Plan
          </button>
        </div>
      )}
    </div>
  )
}

// ── Add stock form ────────────────────────────────────────────────────────────

function AddStockForm({ onAdd }: {
  onAdd: (symbol: string, category: StockCategory, pct: number) => Promise<void>
}) {
  const [symbol, setSymbol]     = useState('')
  const [pct, setPct]           = useState('')
  const [category, setCategory] = useState<StockCategory>('Capital-light Market Infra/Services')
  const [saving, setSaving]     = useState(false)

  async function submit() {
    if (!symbol || !pct) return
    setSaving(true)
    await onAdd(symbol, category, parseFloat(pct))
    setSymbol(''); setPct('')
    setSaving(false)
  }

  return (
    <div className="rounded-2xl border p-4 space-y-3"
         style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="grid grid-cols-2 gap-2">
        <input
          placeholder="Symbol (INFY)"
          value={symbol}
          onChange={e => {
            const s = e.target.value.toUpperCase()
            setSymbol(s)
            if (DEFAULT_CATEGORY[s]) setCategory(DEFAULT_CATEGORY[s])
          }}
          className="px-3 py-3 rounded-xl text-[15px] outline-none uppercase placeholder:normal-case"
          style={{
            background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }} />
        <div className="flex items-center gap-1.5">
          <input type="number" inputMode="decimal" placeholder="%"
            value={pct} onChange={e => setPct(e.target.value)}
            className="flex-1 px-3 py-3 rounded-xl text-[15px] tabnum outline-none"
            style={{
              background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }} />
          <span style={{ color: 'var(--text-muted)' }}>%</span>
        </div>
      </div>
      <select value={category} onChange={e => setCategory(e.target.value as StockCategory)}
        className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
        style={{
          background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}>
        {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <button onClick={submit} disabled={saving || !symbol || !pct}
        className="w-full py-3 rounded-xl font-bold text-[15px] disabled:opacity-30"
        style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
        {saving ? 'Adding…' : 'Add Stock'}
      </button>
    </div>
  )
}

// ── New Plan Sheet ────────────────────────────────────────────────────────────

function NewPlanSheet({ existingFYs, latestAllocations, onClose, onCreate }: {
  existingFYs: FiscalYear[]
  latestAllocations: StockAllocation[]
  onClose: () => void
  onCreate: (fy: FiscalYear, allocs: StockAllocation[]) => void
}) {
  const [label, setLabel]       = useState('')
  const [budget, setBudget]     = useState('')
  const [copyStocks, setCopyStocks] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError]       = useState('')

  // Suggest next FY label
  const suggestedLabel = useMemo(() => {
    if (existingFYs.length === 0) return 'FY26'
    const labels = existingFYs.map(f => f.label)
    const years = labels.map(l => parseInt(l.replace('FY', ''))).filter(Boolean)
    const next = Math.max(...years) + 1
    return `FY${next}`
  }, [existingFYs])

  useState(() => { setLabel(suggestedLabel) })

  function fyDates(label: string): { start: string; end: string } | null {
    const match = label.match(/^FY(\d{2,4})$/)
    if (!match) return null
    let yr = parseInt(match[1])
    if (yr < 100) yr += 2000
    return {
      start: `${yr - 1}-04-01`,
      end:   `${yr}-03-31`,
    }
  }

  async function create() {
    const dates = fyDates(label)
    if (!dates) { setError('Label must be like FY27'); return }
    if (!budget || parseFloat(budget) <= 0) { setError('Enter a valid budget'); return }
    if (existingFYs.some(f => f.label === label)) { setError(`${label} already exists`); return }

    setCreating(true)
    setError('')

    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setCreating(false); return }

    const { data: fy, error: fyErr } = await sb.from('fiscal_years').insert({
      user_id: user.id,
      label,
      start_date: dates.start,
      end_date: dates.end,
      total_budget_inr: parseFloat(budget),
    }).select().single()

    if (fyErr || !fy) { setError(fyErr?.message ?? 'Failed to create plan'); setCreating(false); return }

    let newAllocs: StockAllocation[] = []
    if (copyStocks && latestAllocations.length > 0) {
      const inserts = latestAllocations.map(a => ({
        fy_id: fy.id, user_id: user.id,
        symbol: a.symbol, exchange: a.exchange,
        allocation_pct: a.allocation_pct, category: a.category,
        two_weak_quarters: false, is_hospital_ramp_phase: a.is_hospital_ramp_phase,
      }))
      const { data } = await sb.from('stock_allocations').insert(inserts).select()
      newAllocs = data ?? []
    }

    setCreating(false)
    onCreate(fy, newAllocs)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-[28px] overflow-hidden"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        <div className="flex items-center justify-between px-5 pt-2 pb-4 border-b"
             style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="text-[#0A84FF] text-[17px]">Cancel</button>
          <p className="font-semibold text-[17px]">New Plan</p>
          <button onClick={create} disabled={creating}
            className="text-[#0A84FF] text-[17px] font-semibold disabled:opacity-40">
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>

        <div className="px-5 pt-4 space-y-4">
          {error && (
            <p className="text-red-400 text-[14px] text-center">{error}</p>
          )}

          <div>
            <p className="text-[13px] mb-1.5" style={{ color: 'var(--text-muted)' }}>Fiscal Year</p>
            <input
              placeholder={suggestedLabel}
              value={label}
              onChange={e => setLabel(e.target.value.toUpperCase())}
              className="w-full px-4 py-3.5 rounded-2xl text-[17px] font-bold outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-faint)' }}>
              FY26 = Apr 2025 – Mar 2026
            </p>
          </div>

          <div>
            <p className="text-[13px] mb-1.5" style={{ color: 'var(--text-muted)' }}>Total Budget (₹)</p>
            <input
              type="number" inputMode="decimal" placeholder="2400000"
              value={budget} onChange={e => setBudget(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl text-[17px] tabnum outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
          </div>

          {latestAllocations.length > 0 && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={copyStocks}
                onChange={e => setCopyStocks(e.target.checked)}
                className="w-5 h-5 rounded accent-[#0A84FF]" />
              <div>
                <p className="text-[15px]">Copy {latestAllocations.length} stocks from previous plan</p>
                <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Allocation %s and categories are copied</p>
              </div>
            </label>
          )}
        </div>
      </div>
    </>
  )
}

// ── Playbook Tab ──────────────────────────────────────────────────────────────

function PlaybookTab({ initialPlaybook }: { initialPlaybook: Playbook | null }) {
  const [content, setContent]   = useState(initialPlaybook?.content ?? '')
  const [editing, setEditing]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [lastSaved, setLastSaved] = useState(initialPlaybook?.updated_at ?? null)

  async function save() {
    setSaving(true)
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setSaving(false); return }

    const now = new Date().toISOString()
    await sb.from('playbook').upsert({
      user_id: user.id,
      content,
      updated_at: now,
    }, { onConflict: 'user_id' })

    setLastSaved(now)
    setSaving(false)
    setEditing(false)
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-[17px] font-semibold">Playbook</h2>
          {lastSaved && (
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
              Saved {new Date(lastSaved).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button onClick={() => { setEditing(false); setContent(initialPlaybook?.content ?? '') }}
                className="px-3 py-1.5 rounded-xl text-[14px]"
                style={{ color: 'var(--text-muted)', background: 'var(--border)' }}>
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="px-3 py-1.5 rounded-xl text-[14px] font-semibold text-[#0A84FF] disabled:opacity-40"
                style={{ background: 'rgba(10,132,255,0.15)' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              className="px-3 py-1.5 rounded-xl text-[14px]"
              style={{ color: 'var(--text-muted)', background: 'var(--border)' }}>
              Edit
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={PLAYBOOK_PLACEHOLDER}
          className="w-full rounded-2xl p-4 text-[14px] leading-relaxed outline-none resize-none font-mono"
          style={{
            background: 'var(--bg-secondary)', color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            minHeight: '60vh',
          }}
        />
      ) : (
        <div
          className="rounded-2xl p-4 text-[14px] leading-relaxed whitespace-pre-wrap font-mono"
          style={{
            background: 'var(--bg-secondary)', color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            minHeight: '30vh',
          }}>
          {content || (
            <span style={{ color: 'var(--text-muted)' }}>{PLAYBOOK_PLACEHOLDER}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
    </svg>
  )
}
