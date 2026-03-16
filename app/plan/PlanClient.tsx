'use client'
import { useState, useMemo, useEffect } from 'react'

const SECTOR_TYPE: Record<string, 'Defensive' | 'Cyclical' | 'Growth' | 'REIT' | 'Passive'> = {
  'FMCG':               'Defensive',
  'Pharma':             'Defensive',
  'IT/Technology':      'Defensive',
  'Insurance — Life':   'Defensive',
  'Insurance — General':'Defensive',
  'Auto OEM':           'Cyclical',
  'Capital Goods':      'Cyclical',
  'Banks':              'Cyclical',
  'Defence':            'Cyclical',
  'Cap-Light Infra':    'Growth',
  'Retail':             'Growth',
  'Hospitals':          'Growth',
  'REIT':               'REIT',
  'Index/ETF':          'Passive',
  'Commodity':          'Passive',
}

const SHORT_CAT: Record<string, string> = {
  'Cap-Light Infra':    'Cap-light',
  'Capital Goods':      'Cap.Goods',
  'Insurance — Life':   'Ins.Life',
  'Insurance — General':'Ins.Gen',
  'IT/Technology':      'IT',
  'Index/ETF':          'ETF',
}
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINR, formatPct } from '@/lib/formatter'
import { DEFAULT_CATEGORY, ALL_CATEGORIES, type FiscalYear, type StockAllocation, type StockCategory } from '@/lib/types'
import UserMenu from '@/components/UserMenu'
import FYPicker from '@/components/FYPicker'
import { getStockName } from '@/lib/stock-names'

interface Props {
  fiscalYears: FiscalYear[]
  initialFY: FiscalYear | null
  initialAllocations: StockAllocation[]
}

function setOnboardingStep(step: string) {
  localStorage.setItem('haku_onboarding', step)
  window.dispatchEvent(new Event('haku_onboarding'))
}

export default function PlanClient({ fiscalYears, initialFY, initialAllocations }: Props) {
  const router = useRouter()
  const [selectedFY, setSelectedFY] = useState(initialFY)
  const [allocations, setAllocations] = useState(initialAllocations)
  const [loading, setLoading] = useState(false)
  const [showNewPlan, setShowNewPlan] = useState(false)
  const [fyHasTxns, setFyHasTxns] = useState(false)

  async function deleteFY() {
    if (!selectedFY) return
    const sb = getSupabaseBrowser()

    // Check if any transactions reference this FY — if so, keep the fiscal_years
    // row to avoid orphaning those transactions. Only clear allocations + tranches.
    const { count } = await sb.from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('fy_id', selectedFY.id)

    const hasTxns = (count ?? 0) > 0

    await Promise.all([
      sb.from('stock_allocations').delete().eq('fy_id', selectedFY.id),
      sb.from('buy_tranches').delete().eq('fy_id', selectedFY.id),
    ])

    if (hasTxns) {
      // Reset budget but keep the FY row — transactions stay linked
      await sb.from('fiscal_years').update({ total_budget_inr: 0 }).eq('id', selectedFY.id)
      setAllocations([])
      setSelectedFY({ ...selectedFY, total_budget_inr: 0 })
    } else {
      // No transactions — safe to fully delete
      await sb.from('fiscal_years').delete().eq('id', selectedFY.id)
      setSelectedFY(null)
      setAllocations([])
    }

    router.refresh()
  }

  useEffect(() => {
    if (!selectedFY) { setFyHasTxns(false); return }
    getSupabaseBrowser()
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('fy_id', selectedFY.id)
      .then(({ count }) => setFyHasTxns((count ?? 0) > 0))
  }, [selectedFY?.id])

  useEffect(() => {
    if (fiscalYears.length === 0) {
      setOnboardingStep('plan')
    } else if (allocations.length === 0) {
      setOnboardingStep('stocks')
    } else {
      getSupabaseBrowser()
        .from('buy_bands')
        .select('id', { count: 'exact', head: true })
        .eq('is_current', true)
        .then(({ count }) => setOnboardingStep((count ?? 0) > 0 ? 'done' : 'bands'))
    }
  }, [fiscalYears.length, allocations.length])

  async function switchFY(fy: FiscalYear) {
    setSelectedFY(fy)
    setLoading(true)
    router.replace(`/plan?fy=${encodeURIComponent(fy.label)}`)
    const { data } = await getSupabaseBrowser()
      .from('stock_allocations').select('*')
      .eq('fy_id', fy.id).order('allocation_pct', { ascending: false })
    setAllocations(data ?? [])
    setLoading(false)
  }

  const totalPct = useMemo(() => allocations.reduce((s, a) => s + a.allocation_pct, 0), [allocations])
  const totalBudget = selectedFY?.total_budget_inr ?? 0

  return (
    <div>
      {/* Header */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between px-4 pb-3">
          <h1 className="text-[28px] font-bold">Plan</h1>
          <div className="flex items-center gap-2">
            <FYPicker fiscalYears={fiscalYears} selectedFY={selectedFY} onSelect={switchFY} onNew={() => setShowNewPlan(true)} />
            <UserMenu />
          </div>
        </div>
      </div>

      {fiscalYears.length === 0 && (
        <div className="mx-4 mt-4 p-4 rounded-2xl border"
             style={{ background: 'var(--bg-secondary)', borderColor: 'rgba(10,132,255,0.3)',
                      boxShadow: '0 0 0 1px rgba(10,132,255,0.1)' }}>
          <p className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            Welcome to Haku
          </p>
          <p className="text-[13px] mb-3" style={{ color: 'var(--text-muted)' }}>
            Start by creating your annual investment plan.
          </p>
          <button
            onClick={() => setShowNewPlan(true)}
            className="w-full py-2.5 rounded-xl text-[14px] font-semibold text-white"
            style={{ background: '#0A84FF' }}>
            Create Plan →
          </button>
        </div>
      )}

      <PlanTab
        fiscalYears={fiscalYears}
        selectedFY={selectedFY}
        allocations={allocations}
        loading={loading}
        totalPct={totalPct}
        totalBudget={totalBudget}
        fyHasTxns={fyHasTxns}
        onSwitchFY={switchFY}
        onAllocationsChange={setAllocations}
        onNewPlan={() => setShowNewPlan(true)}
        onFYBudgetChange={(budget) => {
          if (selectedFY) setSelectedFY({ ...selectedFY, total_budget_inr: budget })
        }}
        onDeleteFY={deleteFY}
      />

      {/* New Plan Sheet */}
      {showNewPlan && (
        <NewPlanSheet
          existingFYs={fiscalYears}
          onClose={() => setShowNewPlan(false)}
          onCreate={() => { setShowNewPlan(false); router.refresh() }}
        />
      )}
    </div>
  )
}

// ── Plan Tab ──────────────────────────────────────────────────────────────────

function PlanTab({
  fiscalYears, selectedFY, allocations, loading, totalPct, totalBudget, fyHasTxns,
  onSwitchFY, onAllocationsChange, onNewPlan, onFYBudgetChange, onDeleteFY,
}: {
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
  allocations: StockAllocation[]
  loading: boolean
  totalPct: number
  totalBudget: number
  fyHasTxns: boolean
  onSwitchFY: (fy: FiscalYear) => void
  onAllocationsChange: (allocs: StockAllocation[]) => void
  onNewPlan: () => void
  onFYBudgetChange: (budget: number) => void
  onDeleteFY: () => void
}) {
  const [editBudget, setEditBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState(String(totalBudget))
  const [savingBudget, setSavingBudget] = useState(false)
  const [showAddStock, setShowAddStock] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(false)
  const [copying, setCopying] = useState(false)
  const [showCatDetail, setShowCatDetail] = useState(false)

  const sortedFYs = [...fiscalYears].sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())
  const currentFYIdx = sortedFYs.findIndex(fy => fy.id === selectedFY?.id)
  const prevFY = currentFYIdx > 0 ? sortedFYs[currentFYIdx - 1] : null

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

  async function clearAllStocks() {
    if (!selectedFY) return
    await getSupabaseBrowser().from('stock_allocations').delete().eq('fy_id', selectedFY.id)
    onAllocationsChange([])
    setConfirmClear(false)
  }

  async function copyFromPrevFY() {
    if (!selectedFY || !prevFY) return
    setCopying(true)
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setCopying(false); return }
    const { data: prevAllocs } = await sb.from('stock_allocations').select('*').eq('fy_id', prevFY.id)
    if (!prevAllocs?.length) { setCopying(false); return }
    const { data: newAllocs } = await sb.from('stock_allocations').insert(
      prevAllocs.map(a => ({
        fy_id: selectedFY.id, user_id: user.id,
        symbol: a.symbol, exchange: a.exchange,
        allocation_pct: a.allocation_pct, category: a.category,
        two_weak_quarters: false, two_strong_quarters: false, is_hospital_ramp_phase: false,
      }))
    ).select()
    if (newAllocs) onAllocationsChange([...newAllocs].sort((a, b) => b.allocation_pct - a.allocation_pct))
    setCopying(false)
  }

  const pctOk = Math.abs(totalPct - 100) < 0.01

  return (
    <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

      {selectedFY ? (
        <>
          {/* Budget flat strip */}
          {(() => {
            const stockCarryover = allocations.reduce((s, a) => s + (a.carryover_inr ?? 0), 0)
            const unallocCarryover = selectedFY.unallocated_carryover_inr ?? 0
            const totalCarryover = stockCarryover + unallocCarryover
            const effectiveBudget = totalBudget + totalCarryover
            return (
          <div className="px-4 pt-4 pb-3 border-b"
               style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div>
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
                  <div>
                    <p className="text-[22px] font-bold tabnum mt-0.5">{formatINR(effectiveBudget)}</p>
                    {totalCarryover > 0 && (
                      <p className="text-[11px] tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {formatINR(totalBudget)} base + {formatINR(totalCarryover)} carryover
                      </p>
                    )}
                  </div>
                )}
              </div>
              {editBudget ? (
                <div className="flex gap-2">
                  <button onClick={() => setEditBudget(false)}
                    className="px-3.5 py-2.5 rounded-xl text-[14px]"
                    style={{ color: 'var(--text-muted)', background: 'var(--border)' }}>
                    Cancel
                  </button>
                  <button onClick={saveBudget} disabled={savingBudget}
                    className="px-3.5 py-2.5 rounded-xl text-[14px] font-semibold text-[#0A84FF] disabled:opacity-40"
                    style={{ background: 'rgba(10,132,255,0.15)' }}>
                    {savingBudget ? 'Saving…' : 'Save'}
                  </button>
                </div>
              ) : (
                <button onClick={() => { setBudgetInput(String(totalBudget)); setEditBudget(true) }}
                  className="px-3.5 py-2.5 rounded-xl text-[14px]"
                  style={{ color: 'var(--text-muted)', background: 'var(--border)' }}>
                  Edit
                </button>
              )}
            </div>

            {/* Delete / Clear — shown in edit mode */}
            {editBudget && (
              <div className="flex justify-start mt-1 mb-2">
                {confirmDeletePlan ? (
                  <div className="flex items-center gap-3">
                    <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                      {fyHasTxns ? `Clear allocations for ${selectedFY.label}?` : `Delete ${selectedFY.label}?`}
                    </span>
                    <button onClick={() => setConfirmDeletePlan(false)}
                      className="text-[13px] px-3 py-1.5 rounded-lg"
                      style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)' }}>Cancel</button>
                    <button onClick={() => { setConfirmDeletePlan(false); setEditBudget(false); onDeleteFY() }}
                      className="text-[13px] font-semibold px-3 py-1.5 rounded-lg"
                      style={{ color: '#FF3B30', background: 'rgba(255,59,48,0.10)' }}>
                      {fyHasTxns ? 'Clear' : 'Delete'}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDeletePlan(true)}
                    className="text-[13px] px-3 py-2 rounded-xl"
                    style={{ color: '#FF3B30', background: 'rgba(255,59,48,0.10)' }}>
                    {fyHasTxns ? 'Clear plan' : 'Delete plan'}
                  </button>
                )}
              </div>
            )}

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
            )
          })()}


          {/* Summary: sector types (collapsed) + category breakdown (expanded) */}
          {allocations.length > 0 && (() => {
            const byCat = allocations.reduce<Record<string, number>>((acc, a) => {
              acc[a.category] = (acc[a.category] ?? 0) + a.allocation_pct
              return acc
            }, {})
            const byType = allocations.reduce<Record<string, number>>((acc, a) => {
              const t = SECTOR_TYPE[a.category] ?? 'Growth'
              acc[t] = (acc[t] ?? 0) + a.allocation_pct
              return acc
            }, {})
            const typeColors: Record<string, string> = {
              Defensive: '#34C759', Cyclical: '#FF9F0A', Growth: '#0A84FF', REIT: '#AF52DE', Passive: '#8E8E93',
            }
            return (
              <button
                onClick={() => setShowCatDetail(v => !v)}
                className="w-full text-left px-4 py-3 border-b"
                style={{ borderColor: 'var(--border-faint)' }}>
                {/* Sector types — always visible */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-4 flex-wrap">
                    {(['Defensive', 'Cyclical', 'Growth', 'REIT', 'Passive'] as const)
                      .filter(t => byType[t])
                      .map(t => (
                        <span key={t} className="text-[15px] tabnum font-semibold"
                              style={{ color: typeColors[t] }}>
                          {t} {(byType[t] ?? 0).toFixed(0)}%
                        </span>
                      ))}
                  </div>
                  <ChevronIcon className={`w-4 h-4 flex-shrink-0 ml-2 transition-transform ${showCatDetail ? 'rotate-180' : ''}`} />
                </div>
                {/* Category breakdown — 2-column grid, expanded only */}
                {showCatDetail && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 pt-3 border-t"
                       style={{ borderColor: 'var(--border-faint)' }}>
                    {Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, pct]) => (
                      <div key={cat} className="flex items-baseline justify-between">
                        <span className="text-[13px] truncate" style={{ color: 'var(--text-2)' }}>
                          {SHORT_CAT[cat] ?? cat}
                        </span>
                        <span className="text-[13px] font-semibold tabnum ml-2 flex-shrink-0"
                              style={{ color: 'var(--text-primary)' }}>
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            )
          })()}

          {/* Stock list */}
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 rounded-full"
                   style={{ borderColor: 'var(--border)', borderTopColor: 'var(--text-primary)',
                            animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : (
            <div>
              {/* Toolbar */}
              <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-b"
                   style={{ borderColor: 'var(--border-faint)' }}>
                <div className="flex items-center gap-2">
                  {allocations.length > 0 && !confirmClear && (
                    <>
                      <button onClick={() => setConfirmClear(true)}
                        className="text-[15px] px-3 py-2.5 rounded-xl"
                        style={{ color: 'var(--text-2)', background: 'var(--bg-tertiary)' }}>
                        Clear All
                      </button>
                      <button
                        onClick={async () => {
                          const sorted = [...allocations].sort((a, b) => b.allocation_pct - a.allocation_pct)
                          const lines = sorted.map(a => {
                            const budget = (a.allocation_pct / 100) * totalBudget
                            return `${a.symbol.padEnd(10)} ${String(a.allocation_pct).padStart(3)}%   ₹${(budget / 100000).toFixed(1)}L`
                          })
                          const total = allocations.reduce((s, a) => s + a.allocation_pct, 0)
                          const text = [
                            `${selectedFY?.label ?? 'Portfolio'}`,
                            '─'.repeat(28),
                            ...lines,
                            '─'.repeat(28),
                            `${'Total'.padEnd(10)} ${String(total.toFixed(0)).padStart(3)}%   ₹${(totalBudget / 100000).toFixed(1)}L`,
                          ].join('\n')
                          if (navigator.share) {
                            await navigator.share({ title: `${selectedFY?.label ?? 'Portfolio'} Allocation`, text })
                          } else {
                            await navigator.clipboard.writeText(text)
                          }
                        }}
                        className="text-[15px] px-3 py-2.5 rounded-xl"
                        style={{ color: 'var(--text-2)', background: 'var(--bg-tertiary)' }}>
                        Export
                      </button>
                    </>
                  )}
                  {confirmClear && (
                    <>
                      <button onClick={() => setConfirmClear(false)}
                        className="text-[15px] px-3 py-2.5 rounded-xl"
                        style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)' }}>Cancel</button>
                      <button onClick={clearAllStocks}
                        className="text-[15px] font-semibold px-3 py-2.5 rounded-xl"
                        style={{ color: '#FF3B30', background: 'rgba(255,59,48,0.10)' }}>Remove all?</button>
                    </>
                  )}
                  {!confirmClear && (
                    <button onClick={() => setShowAddStock(v => !v)}
                      className="text-[14px] font-medium px-3 py-2 rounded-xl"
                      style={{ color: '#0A84FF', background: 'rgba(10,132,255,0.12)' }}>
                      {showAddStock ? 'Cancel' : '+ Add Stock'}
                    </button>
                  )}
                </div>
              </div>

              {showAddStock && (
                <AddStockForm totalPct={totalPct} onAdd={addStock} />
              )}

              <div className="divide-y" style={{ borderColor: 'var(--border-faint)' }}>
                {[...allocations]
                  .sort((a, b) => b.allocation_pct - a.allocation_pct || a.symbol.localeCompare(b.symbol))
                  .map(alloc => (
                  <StockAllocRow
                    key={alloc.id}
                    alloc={alloc}
                    totalBudget={totalBudget}
                    totalPct={totalPct}
                    onPctChange={updateAllocPct}
                    onCategoryChange={updateAllocCategory}
                    onRemove={removeAlloc}
                  />
                ))}
              </div>

              {allocations.length === 0 && !showAddStock && (
                <div className="px-4 pt-4 space-y-2">
                  {prevFY && (
                    <button onClick={copyFromPrevFY} disabled={copying}
                      className="w-full py-3 rounded-2xl text-[15px] font-semibold disabled:opacity-40"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                      {copying ? 'Copying…' : `Copy stocks from ${prevFY.label}`}
                    </button>
                  )}
                  <button onClick={() => setShowAddStock(true)}
                    className="w-full py-3 rounded-2xl text-[15px] font-medium"
                    style={{ color: '#0A84FF', border: '1px solid rgba(10,132,255,0.3)', background: 'transparent' }}>
                    + Add Stock manually
                  </button>
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

function StockAllocRow({ alloc, totalBudget, totalPct, onPctChange, onCategoryChange, onRemove }: {
  alloc: StockAllocation
  totalBudget: number
  totalPct: number
  onPctChange: (a: StockAllocation, pct: number) => void
  onCategoryChange: (a: StockAllocation, cat: StockCategory) => void
  onRemove: (id: string) => void
}) {
  const [pct, setPct] = useState(alloc.allocation_pct.toString())
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const budget = (alloc.allocation_pct / 100) * totalBudget
  const parsedPct = parseFloat(pct) || alloc.allocation_pct
  const effectiveTotal = totalPct - alloc.allocation_pct + parsedPct
  const remaining = 100 - effectiveTotal

  if (confirming) {
    return (
      <div className="flex items-center justify-between px-4 py-3.5">
        <p className="text-[15px]" style={{ color: 'var(--text-2)' }}>Remove {alloc.symbol}?</p>
        <p className="text-[12px] flex-1 px-3" style={{ color: 'var(--text-muted)' }}>Transactions kept</p>
        <div className="flex gap-4">
          <button onClick={() => setConfirming(false)} className="text-[#0A84FF] text-[15px]">Keep</button>
          <button onClick={() => onRemove(alloc.id)} className="text-red-400 text-[15px] font-semibold">Remove</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button onClick={() => setExpanded(v => !v)} className="flex-1 flex items-center gap-3 text-left">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-[17px]">{alloc.symbol}</p>
            {getStockName(alloc.symbol) && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-2)' }}>{getStockName(alloc.symbol)}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[15px] font-medium" style={{ color: 'var(--text-2)' }}>
              {alloc.category.split('/')[0]}
            </p>
            <p className="text-[13px] tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {formatINR(budget)}
              {(alloc.carryover_inr ?? 0) > 0 && (
                <span style={{ color: '#30D158' }}> +{formatINR(alloc.carryover_inr)}</span>
              )}
            </p>
          </div>
        </button>

        {/* Pct input */}
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1">
            <input
              type="number" inputMode="decimal" value={pct}
              onChange={e => setPct(e.target.value)}
              onBlur={() => {
                const val = parseFloat(pct)
                if (val > 0 && val !== alloc.allocation_pct) onPctChange(alloc, val)
              }}
              className="w-14 px-2 py-2.5 rounded-xl text-[15px] tabnum text-right outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
            <span className="text-[15px]" style={{ color: 'var(--text-muted)' }}>%</span>
          </div>
          {parsedPct !== alloc.allocation_pct && (
            <span className={`text-[12px] tabnum ${remaining < 0 ? 'text-red-400' : remaining === 0 ? 'text-green-500' : ''}`}
                  style={remaining > 0 ? { color: 'var(--text-muted)' } : undefined}>
              {remaining < 0 ? `${Math.abs(remaining).toFixed(1)}% over` : `${remaining.toFixed(1)}% left`}
            </span>
          )}
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

function AddStockForm({ totalPct, onAdd }: {
  totalPct: number
  onAdd: (symbol: string, category: StockCategory, pct: number) => Promise<void>
}) {
  const [symbol, setSymbol]     = useState('')
  const [pct, setPct]           = useState('')
  const [category, setCategory] = useState<StockCategory>('Cap-Light Infra')
  const [saving, setSaving]     = useState(false)

  const remaining = 100 - totalPct - (parseFloat(pct) || 0)

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
      {/* Remaining % indicator */}
      <div className="flex items-center justify-between">
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Allocated so far: {totalPct.toFixed(1)}%</p>
        <p className={`text-[12px] font-semibold tabnum ${remaining < 0 ? 'text-red-400' : remaining === 0 ? 'text-green-500' : ''}`}
           style={remaining > 0 ? { color: 'var(--text-2)' } : undefined}>
          {remaining < 0 ? `${Math.abs(remaining).toFixed(1)}% over` : `${remaining.toFixed(1)}% left`}
        </p>
      </div>
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
        <div className="relative">
          <input type="number" inputMode="decimal" placeholder="10"
            value={pct} onChange={e => setPct(e.target.value)}
            className="w-full px-3 pr-8 py-3 rounded-xl text-[15px] tabnum outline-none"
            style={{
              background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }} />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[15px] pointer-events-none"
                style={{ color: 'var(--text-muted)' }}>%</span>
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

function NewPlanSheet({ existingFYs, onClose, onCreate }: {
  existingFYs: FiscalYear[]
  onClose: () => void
  onCreate: () => void
}) {
  const currentYear = new Date().getFullYear()
  const yearRange = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2, currentYear + 3]
  const existingLabels = new Set(existingFYs.map(f => f.label))

  const [selectedYear, setSelectedYear] = useState<number | null>(() => {
    return yearRange.find(y => !existingLabels.has(`FY${y}`)) ?? null
  })
  const [budget, setBudget]             = useState('')
  const [copyStocks, setCopyStocks]     = useState(true)
  const [creating, setCreating]         = useState(false)
  const [error, setError]               = useState('')
  const [sourceFY, setSourceFY]         = useState<FiscalYear | null>(null)
  const [sourceAllocs, setSourceAllocs] = useState<StockAllocation[]>([])
  const [carryoverBySymbol, setCarryoverBySymbol] = useState<Record<string, number>>({})

  const label = selectedYear ? `FY${selectedYear}` : ''

  // When the user picks a year, find the chronologically prior FY and compute carryover
  useEffect(() => {
    if (!selectedYear) return
    const newStart = new Date(`${selectedYear}-04-01`)
    // Find the FY with start_date immediately before the new FY's start
    const sorted = [...existingFYs]
      .filter(fy => new Date(fy.start_date) < newStart)
      .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())
    const prior = sorted[0] ?? null
    setSourceFY(prior)
    setSourceAllocs([])
    setCarryoverBySymbol({})

    if (!prior) return

    async function computeCarryover() {
      const sb = getSupabaseBrowser()
      const { data: allocs } = await sb
        .from('stock_allocations').select('*')
        .eq('fy_id', prior!.id)
      if (!allocs?.length) return
      setSourceAllocs(allocs)

      const symbols = allocs.map((a: StockAllocation) => a.symbol)
      // Filter transactions to the source FY only — key fix for chronological correctness
      const { data: txns } = await sb
        .from('transactions')
        .select('symbol, trade_type, amount')
        .eq('fy_id', prior!.id)
        .in('symbol', symbols)

      const netBySymbol: Record<string, number> = {}
      for (const t of txns ?? []) {
        const sign = t.trade_type === 'buy' ? 1 : -1
        netBySymbol[t.symbol] = (netBySymbol[t.symbol] ?? 0) + sign * t.amount
      }
      const carryover: Record<string, number> = {}
      for (const a of allocs) {
        const stockBudget = (a.allocation_pct / 100) * prior!.total_budget_inr
        const spent = netBySymbol[a.symbol] ?? 0
        carryover[a.symbol] = Math.max(0, stockBudget - spent)
      }
      setCarryoverBySymbol(carryover)
    }
    computeCarryover()
  }, [selectedYear, existingFYs])

  async function create() {
    if (!selectedYear) { setError('Select a fiscal year'); return }
    if (!budget || parseFloat(budget) <= 0) { setError('Enter a valid budget'); return }
    if (existingLabels.has(label)) { setError(`${label} already exists`); return }
    const dates = { start: `${selectedYear}-04-01`, end: `${selectedYear + 1}-03-31` }

    setCreating(true)
    setError('')

    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setCreating(false); return }

    // Compute unallocated carryover (from stocks NOT copied into new plan)
    const allSymbols = sourceAllocs.map(a => a.symbol)
    const droppedSymbols = copyStocks ? [] : allSymbols
    const unallocatedCarryover = droppedSymbols.reduce((sum, s) => sum + (carryoverBySymbol[s] ?? 0), 0)

    const { data: fy, error: fyErr } = await sb.from('fiscal_years').insert({
      user_id: user.id,
      label,
      start_date: dates.start,
      end_date: dates.end,
      total_budget_inr: parseFloat(budget),
      unallocated_carryover_inr: unallocatedCarryover,
    }).select().single()

    if (fyErr || !fy) { setError(fyErr?.message ?? 'Failed to create plan'); setCreating(false); return }

    if (copyStocks && sourceAllocs.length > 0) {
      const inserts = sourceAllocs.map(a => ({
        fy_id: fy.id, user_id: user.id,
        symbol: a.symbol, exchange: a.exchange,
        allocation_pct: a.allocation_pct, category: a.category,
        two_weak_quarters: false, is_hospital_ramp_phase: a.is_hospital_ramp_phase,
        carryover_inr: carryoverBySymbol[a.symbol] ?? 0,
      }))
      await sb.from('stock_allocations').insert(inserts)
    }

    setCreating(false)
    onCreate()
  }

  const totalCarryover = Object.values(carryoverBySymbol).reduce((s, v) => s + v, 0)

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
            <p className="text-[13px] mb-2" style={{ color: 'var(--text-muted)' }}>Fiscal Year</p>
            <div className="flex gap-2 flex-wrap">
              {yearRange.map(yr => {
                const taken = existingLabels.has(`FY${yr}`)
                const active = selectedYear === yr
                return (
                  <button key={yr} type="button"
                    onClick={() => !taken && setSelectedYear(yr)}
                    disabled={taken}
                    className="px-4 py-2.5 rounded-xl text-[15px] font-semibold transition-colors disabled:opacity-35"
                    style={active
                      ? { background: 'var(--text-primary)', color: 'var(--bg-primary)' }
                      : { background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                    FY{yr}
                  </button>
                )
              })}
            </div>
            {selectedYear && (
              <p className="text-[12px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
                Apr {selectedYear} – Mar {selectedYear + 1}
              </p>
            )}
          </div>

          <div>
            <p className="text-[13px] mb-1.5" style={{ color: 'var(--text-muted)' }}>Total Budget (₹)</p>
            <input
              type="number" inputMode="decimal" placeholder="2400000"
              value={budget} onChange={e => setBudget(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl text-[17px] tabnum outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
          </div>

          {sourceAllocs.length > 0 && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={copyStocks}
                onChange={e => setCopyStocks(e.target.checked)}
                className="w-5 h-5 rounded accent-[#0A84FF]" />
              <div>
                <p className="text-[15px]">Copy {sourceAllocs.length} stocks from {sourceFY?.label}</p>
                <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Allocation %s and categories are copied
                  {copyStocks && totalCarryover > 0 && ` · ${formatINR(totalCarryover)} carryover carried in`}
                  {!copyStocks && totalCarryover > 0 && ` · ${formatINR(totalCarryover)} goes to unallocated`}
                </p>
              </div>
            </label>
          )}

          {totalCarryover > 0 && copyStocks && (
            <div className="rounded-2xl p-3 space-y-1"
                 style={{ background: 'rgba(48,209,88,0.08)', border: '1px solid rgba(48,209,88,0.2)' }}>
              <p className="text-[12px] font-semibold" style={{ color: '#30D158' }}>
                Carryover from previous plan
              </p>
              {Object.entries(carryoverBySymbol)
                .filter(([, v]) => v > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([sym, amt]) => (
                  <div key={sym} className="flex justify-between text-[12px] tabnum">
                    <span style={{ color: 'var(--text-2)' }}>{sym}</span>
                    <span style={{ color: '#30D158' }}>{formatINR(amt)}</span>
                  </div>
                ))}
              <div className="flex justify-between text-[12px] font-semibold tabnum pt-1 border-t"
                   style={{ borderColor: 'rgba(48,209,88,0.2)', color: '#30D158' }}>
                <span>Total</span>
                <span>{formatINR(totalCarryover)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

