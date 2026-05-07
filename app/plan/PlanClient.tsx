'use client'
import { useState, useMemo, useEffect } from 'react'


import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINRFine, formatINRFull } from '@/lib/formatter'
import { Num } from '@/components/Num'
import { DEFAULT_CATEGORY, ALL_CATEGORIES, type FiscalYear, type StockAllocation, type StockCategory } from '@/lib/types'
import UserMenu from '@/components/UserMenu'
import FYPicker from '@/components/FYPicker'
import { getStockName } from '@/lib/stock-names'
import { revalidateFiscalYears, getAllocationsForFY, checkFYHasTxns, getPrevFYCarryover, hasBands, copyAllocations } from '@/app/actions'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'

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

    // fyHasTxns is kept up-to-date by the useEffect below — use it directly
    // instead of issuing a duplicate count query here.
    await Promise.all([
      sb.from('stock_allocations').delete().eq('fy_id', selectedFY.id),
      sb.from('buy_tranches').delete().eq('fy_id', selectedFY.id),
    ])

    if (fyHasTxns) {
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
    checkFYHasTxns(selectedFY.id).then(setFyHasTxns)
  }, [selectedFY?.id])

  useEffect(() => {
    if (fiscalYears.length === 0) {
      setOnboardingStep('plan')
    } else if (allocations.length === 0) {
      setOnboardingStep('stocks')
    } else {
      hasBands().then(has => setOnboardingStep(has ? 'done' : 'bands'))
    }
  }, [fiscalYears.length, allocations.length])

  async function switchFY(fy: FiscalYear) {
    setSelectedFY(fy)
    setLoading(true)
    router.replace(`/plan?fy=${encodeURIComponent(fy.label)}`)
    const data = await getAllocationsForFY(fy.id)
    setAllocations(data)
    setLoading(false)
  }

  const totalPct = useMemo(() => allocations.reduce((s, a) => s + a.allocation_pct, 0), [allocations])
  const totalBudget = selectedFY?.total_budget_inr ?? 0

  return (
    <div style={{ minHeight: '100dvh' }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between px-4 pb-3">
          <h1 className="text-display font-bold">Plan</h1>
          <div className="flex items-center gap-2">
            <FYPicker fiscalYears={fiscalYears} selectedFY={selectedFY} onSelect={switchFY} onNew={() => setShowNewPlan(true)} />
            <UserMenu />
          </div>
        </div>
      </div>

      {fiscalYears.length === 0 && (
        <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <p className="text-body font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            Welcome to Haku
          </p>
          <p className="text-subheadline mb-3" style={{ color: 'var(--text-muted)' }}>
            Start by creating your annual investment plan.
          </p>
          <button
            onClick={() => setShowNewPlan(true)}
            className="text-body font-semibold text-accent">
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
          onCreate={(fy) => { setShowNewPlan(false); setSelectedFY(fy); setAllocations([]); router.refresh() }}
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
  const [showBudgetSheet, setShowBudgetSheet] = useState(false)
  const [editingAlloc, setEditingAlloc] = useState<StockAllocation | null>(null)
  const [showAddStock, setShowAddStock] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [copying, setCopying] = useState(false)
  const [carryoverAmt, setCarryoverAmt] = useState<number | null>(null)
  const [carryoverDismissed, setCarryoverDismissed] = useState(false)
  const [applyingCarryover, setApplyingCarryover] = useState(false)

  const sortedFYs = [...fiscalYears].sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())
  const currentFYIdx = sortedFYs.findIndex(fy => fy.id === selectedFY?.id)
  const prevFY = currentFYIdx > 0 ? sortedFYs[currentFYIdx - 1] : null

  const unallocCarryover = selectedFY?.unallocated_carryover_inr ?? 0
  const effectiveBudget = totalBudget + unallocCarryover

  // Check if prev FY has undeployed budget to carry over
  useEffect(() => {
    setCarryoverAmt(null)
    setCarryoverDismissed(false)
    if (!prevFY || !selectedFY) return
    if (new Date(prevFY.end_date) >= new Date()) return // prev FY hasn't ended yet
    if ((selectedFY.unallocated_carryover_inr ?? 0) > 0) return // already applied
    const dismissKey = `carryover_dismissed_${selectedFY.id}`
    if (typeof window !== 'undefined' && localStorage.getItem(dismissKey)) { setCarryoverDismissed(true); return }
    getPrevFYCarryover(prevFY.id, prevFY.total_budget_inr ?? 0)
      .then(leftover => { if (leftover > 0) setCarryoverAmt(leftover) })
  }, [prevFY?.id, selectedFY?.id])

  async function applyCarryover() {
    if (!selectedFY || !carryoverAmt) return
    setApplyingCarryover(true)
    await getSupabaseBrowser().from('fiscal_years')
      .update({ unallocated_carryover_inr: carryoverAmt })
      .eq('id', selectedFY.id)
    setCarryoverAmt(null)
    setApplyingCarryover(false)
  }

  async function saveBudget(budget: number) {
    if (!selectedFY) return
    await getSupabaseBrowser().from('fiscal_years')
      .update({ total_budget_inr: budget })
      .eq('id', selectedFY.id)
    onFYBudgetChange(budget)
    setShowBudgetSheet(false)
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
    }).select().single()
    if (data) onAllocationsChange([...allocations, data].sort((a, b) => b.allocation_pct - a.allocation_pct))
    setShowAddStock(false)
  }

  async function renameAllocSymbol(alloc: StockAllocation, newSymbol: string) {
    const sb = getSupabaseBrowser()
    await sb.from('stock_allocations').update({ symbol: newSymbol }).eq('id', alloc.id)
    await Promise.all([
      sb.from('buy_bands').update({ symbol: newSymbol }).eq('symbol', alloc.symbol),
      sb.from('buy_tranches').update({ symbol: newSymbol }).eq('symbol', alloc.symbol),
    ])
    onAllocationsChange(allocations.map(a => a.id === alloc.id ? { ...a, symbol: newSymbol } : a))
    setEditingAlloc(prev => prev?.id === alloc.id ? { ...prev, symbol: newSymbol } : prev)
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
    const newAllocs = await copyAllocations(prevFY.id, selectedFY.id)
    if (newAllocs.length) onAllocationsChange([...newAllocs].sort((a, b) => b.allocation_pct - a.allocation_pct))
    setCopying(false)
  }

  return (
    <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

      {selectedFY ? (
        <>
          {/* Carryover banner */}
          {carryoverAmt !== null && !carryoverDismissed && prevFY && (
            <div className="px-4 py-3 border-b"
                 style={{ background: 'rgba(10,132,255,0.04)', borderColor: 'var(--border)' }}>
              <div className="flex items-start gap-2.5">
                <span className="text-[18px] mt-0.5">↩</span>
                <div className="flex-1">
                  <p className="text-subheadline font-semibold text-accent">
                    {prevFY.label} carryover available
                  </p>
                  <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {formatINRFine(carryoverAmt)} undeployed · add to {selectedFY.label} budget?
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-2.5">
                <button
                  onClick={() => {
                    if (typeof window !== 'undefined') localStorage.setItem(`carryover_dismissed_${selectedFY.id}`, '1')
                    setCarryoverDismissed(true)
                  }}
                  className="px-3 rounded-xl text-subheadline"
                  style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', minHeight: 44 }}>
                  Cancel
                </button>
                <button
                  onClick={applyCarryover}
                  disabled={applyingCarryover}
                  className="px-3 rounded-xl text-subheadline font-semibold disabled:opacity-40 bg-accent text-white"
                  style={{ minHeight: 44 }}>
                  {applyingCarryover ? '…' : 'Add'}
                </button>
              </div>
            </div>
          )}

          {/* Budget strip */}
          <div className="border-b" style={{ borderColor: 'var(--border)' }}>
            <button onClick={() => setShowBudgetSheet(true)}
              className="w-full flex items-center justify-between px-4 py-3.5 tap-row">
              <span className="text-headline" style={{ color: 'var(--text-2)' }}>Plan</span>
              <div className="flex items-center px-3 py-1.5 rounded-xl"
                   style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
                <span className="text-title-2 font-bold tabnum"><Num amount={effectiveBudget} /></span>
              </div>
            </button>
            {unallocCarryover > 0 && prevFY && (
              <p className="text-footnote tabnum px-4 pb-2" style={{ color: 'var(--text-faint)' }}>
                incl. <Num amount={unallocCarryover} /> carryover from {prevFY.label}
              </p>
            )}
          </div>


          {/* Stock list */}
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 rounded-full"
                   style={{ borderColor: 'var(--border)', borderTopColor: 'var(--text-primary)',
                            animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : (
            <div>
              {/* Section header */}
              <div className="flex items-center justify-between px-4 pt-5 pb-2">
                <p className="text-footnote font-bold uppercase"
                   style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>
                  Target Allocations
                </p>
                {allocations.length > 0 && (() => {
                  const over = totalPct > 100
                  const exact = totalPct === 100
                  const bg = over
                    ? 'rgba(255,59,48,0.12)'
                    : exact
                    ? 'rgba(48,209,88,0.12)'
                    : 'rgba(255,149,0,0.12)'
                  const colorClass = over ? 'text-negative' : exact ? 'text-positive' : 'text-warning'
                  const label = exact
                    ? '100%'
                    : over
                    ? `${Math.round(totalPct)}% · over`
                    : `${Math.round(totalPct)}% · ${Math.round(100 - totalPct)}% free`
                  return (
                    <span
                      className={`text-footnote font-bold tabnum ${colorClass}`}
                      style={{ background: bg, borderRadius: 20, padding: '2px 8px' }}>
                      {label}
                    </span>
                  )
                })()}
              </div>

              <div className="divide-y divide-[color:var(--divider)]">
                {[...allocations]
                  .sort((a, b) => b.allocation_pct - a.allocation_pct || a.symbol.localeCompare(b.symbol))
                  .map(alloc => (
                  <StockAllocRow
                    key={alloc.id}
                    alloc={alloc}
                    totalBudget={effectiveBudget}
                    onEdit={() => setEditingAlloc(alloc)}
                  />
                ))}
              </div>

              {/* Add Stock row */}
              {!confirmClear && (
                <button onClick={() => setShowAddStock(true)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 border-t tap-row"
                  style={{ borderColor: 'var(--border-faint)' }}>
                  <div className="w-6 h-6 rounded-full bg-positive flex items-center justify-center flex-shrink-0">
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M12 4v16m8-8H4"/>
                    </svg>
                  </div>
                  <span className="text-body text-accent">Add Stock</span>
                </button>
              )}

              {/* Footer rows — Export + Clear All */}
              {allocations.length > 0 && (
                <div className="mt-8 border-t" style={{ borderColor: 'var(--border-faint)' }}>
                  <button
                    onClick={async () => {
                      const sorted = [...allocations].sort((a, b) => b.allocation_pct - a.allocation_pct)
                      const lines = sorted.map(a => {
                        const budget = (a.allocation_pct / 100) * effectiveBudget
                        return `${a.symbol.padEnd(10)} ${String(a.allocation_pct).padStart(3)}%   ${(budget / 100000).toFixed(1)}L`
                      })
                      const total = allocations.reduce((s, a) => s + a.allocation_pct, 0)
                      const text = [
                        `${selectedFY?.label ?? 'Portfolio'}`,
                        '─'.repeat(28),
                        ...lines,
                        '─'.repeat(28),
                        `${'Total'.padEnd(10)} ${String(total.toFixed(0)).padStart(3)}%   ${(effectiveBudget / 100000).toFixed(1)}L`,
                      ].join('\n')
                      if (navigator.share) {
                        await navigator.share({ title: `${selectedFY?.label ?? 'Portfolio'} Allocation`, text })
                      } else {
                        await navigator.clipboard.writeText(text)
                      }
                    }}
                    className="w-full text-left px-4 py-4 border-b text-body text-accent tap-row"
                    style={{ borderColor: 'var(--border-faint)' }}>
                    Export Plan
                  </button>
                  {!confirmClear ? (
                    <button onClick={() => setConfirmClear(true)}
                      className="w-full text-left px-4 py-4 text-body text-negative tap-row">
                      Clear All
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 px-4 py-3">
                      <button onClick={() => setConfirmClear(false)}
                        className="text-body px-3 rounded-xl"
                        style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', minHeight: 44 }}>Cancel</button>
                      <button onClick={clearAllStocks}
                        className="text-body font-semibold px-3 rounded-xl text-negative"
                        style={{ background: 'rgba(255,59,48,0.10)', minHeight: 44 }}>Remove all?</button>
                    </div>
                  )}
                </div>
              )}

              {allocations.length === 0 && !showAddStock && (
                <div className="px-4 pt-4 space-y-2">
                  {prevFY && (
                    <button onClick={copyFromPrevFY} disabled={copying}
                      className="w-full py-3 rounded-2xl text-body font-semibold disabled:opacity-40"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                      {copying ? 'Copying…' : `Copy stocks from ${prevFY.label}`}
                    </button>
                  )}
                  <button onClick={() => setShowAddStock(true)}
                    className="w-full py-3 rounded-2xl text-body font-medium text-accent"
                    style={{ border: '1px solid rgba(10,132,255,0.3)', background: 'transparent' }}>
                    Add Stock
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-20 px-6" style={{ color: 'var(--text-muted)' }}>
          <p className="text-headline font-medium mb-2">No plan yet</p>
          <p className="text-body mb-4">Create a plan to start allocating your investments for the year.</p>
        </div>
      )}

      {showAddStock && selectedFY && (
        <AddStockSheet
          totalPct={totalPct}
          totalBudget={effectiveBudget}
          onClose={() => setShowAddStock(false)}
          onAdd={async (symbol, category, pct) => { await addStock(symbol, category, pct); setShowAddStock(false) }}
        />
      )}

      {showBudgetSheet && selectedFY && (
        <BudgetSheet
          selectedFY={selectedFY}
          fyHasTxns={fyHasTxns}
          prevFYLabel={prevFY?.label}
          onClose={() => setShowBudgetSheet(false)}
          onSave={saveBudget}
          onDeleteFY={() => { setShowBudgetSheet(false); onDeleteFY() }}
        />
      )}

      {editingAlloc && (
        <StockEditSheet
          alloc={editingAlloc}
          totalBudget={effectiveBudget}
          totalPct={totalPct}
          onClose={() => setEditingAlloc(null)}
          onSave={async (pct) => { await updateAllocPct(editingAlloc, pct); setEditingAlloc(null) }}
          onCategoryChange={async (cat) => { await updateAllocCategory(editingAlloc, cat); setEditingAlloc({ ...editingAlloc, category: cat }) }}
          onRemove={async () => { await removeAlloc(editingAlloc.id); setEditingAlloc(null) }}
          onRename={async (newSym) => { await renameAllocSymbol(editingAlloc, newSym) }}
        />
      )}
    </div>
  )
}

// ── Stock allocation row ──────────────────────────────────────────────────────

function StockAllocRow({ alloc, totalBudget, onEdit }: {
  alloc: StockAllocation
  totalBudget: number
  onEdit: () => void
}) {
  const budget = (alloc.allocation_pct / 100) * totalBudget
  const name = getStockName(alloc.symbol)
  return (
    <button onClick={onEdit} className="w-full flex items-center gap-3 px-4 py-4 text-left tap-row">
      <div className="flex-1 min-w-0">
        <p className="font-bold text-headline">{alloc.symbol}</p>
        {name && <p className="text-footnote mt-0.5" style={{ color: 'var(--text-muted)' }}>{name}</p>}
      </div>
      <div className="text-right">
        <p className="text-headline font-semibold tabnum text-accent">{alloc.allocation_pct}%</p>
        <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatINRFull(budget)}</p>
      </div>
      <ChevronIcon className="w-4 h-4 flex-shrink-0 ml-1" style={{ color: 'var(--text-faint)' }} />
    </button>
  )
}

// ── Budget edit sheet ─────────────────────────────────────────────────────────

function BudgetSheet({ selectedFY, fyHasTxns, prevFYLabel, onClose, onSave, onDeleteFY }: {
  selectedFY: FiscalYear
  fyHasTxns: boolean
  prevFYLabel?: string
  onClose: () => void
  onSave: (budget: number) => Promise<void>
  onDeleteFY: () => void
}) {
  const [budgetInput, setBudgetInput] = useState(String(selectedFY.total_budget_inr))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const kh = useKeyboardHeight()

  async function handleSave() {
    const budget = parseFloat(budgetInput)
    if (!budget || budget <= 0) return
    setSaving(true)
    await onSave(budget)
    await revalidateFiscalYears()
    setSaving(false)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <div className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl sheet-kb"
           style={{ bottom: kh, background: 'var(--bg-secondary)', paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>
          <p className="font-semibold text-headline">{selectedFY.label} Budget</p>
          <button onClick={handleSave} disabled={saving}
            className="text-accent text-headline font-semibold disabled:opacity-40"
            style={{ minHeight: 44 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {/* FY Budget field */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <p className="text-body">FY Budget</p>
          <input
            type="number" inputMode="decimal"
            value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
            className="text-headline font-semibold tabnum text-right outline-none rounded-xl px-3 py-1.5 w-36"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            autoFocus
          />
        </div>

        {/* Carryover context — read-only */}
        {(() => {
          const carryover = selectedFY.unallocated_carryover_inr ?? 0
          const fyBudget = parseFloat(budgetInput) || selectedFY.total_budget_inr
          if (carryover <= 0 || !prevFYLabel) return null
          return (
            <div className="flex items-center justify-between px-5 border-b" style={{ minHeight: 36, borderColor: 'var(--border-faint)' }}>
              <p className="text-subheadline tabnum" style={{ color: 'var(--text-muted)' }}>
                + <Num amount={carryover} /> carryover from {prevFYLabel}
              </p>
              <p className="text-subheadline font-semibold tabnum" style={{ color: 'var(--text-primary)' }}>
                = <Num amount={fyBudget + carryover} />
              </p>
            </div>
          )
        })()}

        {/* Delete plan */}
        <div className="px-5 pt-2">
          {confirmDelete ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-subheadline" style={{ color: 'var(--text-muted)' }}>
                {fyHasTxns ? 'Clear allocations?' : 'Delete this plan?'}
              </p>
              <button onClick={() => setConfirmDelete(false)}
                className="px-3 rounded-xl text-subheadline"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', minHeight: 44 }}>No</button>
              <button onClick={onDeleteFY}
                className="px-3 rounded-xl text-subheadline font-semibold text-negative"
                style={{ background: 'rgba(255,59,48,0.10)', minHeight: 44 }}>
                {fyHasTxns ? 'Clear' : 'Delete'}
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="w-full py-3 rounded-xl text-body font-medium text-negative"
              style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.18)' }}>
              {fyHasTxns ? 'Clear Plan' : 'Delete Plan'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// ── Stock edit sheet ──────────────────────────────────────────────────────────

function StockEditSheet({ alloc, totalBudget, totalPct, onClose, onSave, onCategoryChange, onRemove, onRename }: {
  alloc: StockAllocation
  totalBudget: number
  totalPct: number
  onClose: () => void
  onSave: (pct: number) => Promise<void>
  onCategoryChange: (cat: StockCategory) => Promise<void>
  onRemove: () => Promise<void>
  onRename: (newSymbol: string) => Promise<void>
}) {
  const [pct, setPct] = useState(alloc.allocation_pct)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newSymbol, setNewSymbol] = useState(alloc.symbol)
  const [renameSaving, setRenameSaving] = useState(false)

  const freeWithoutThis   = 100 - totalPct + alloc.allocation_pct
  const sliderMax         = Math.min(100, alloc.allocation_pct + freeWithoutThis)
  const planAllocatedPct  = totalPct - alloc.allocation_pct + pct
  const planFreePct       = 100 - planAllocatedPct
  const planAllocatedInr  = (planAllocatedPct / 100) * totalBudget
  const planFreeInr       = (planFreePct / 100) * totalBudget

  async function handleSave() {
    if (pct <= 0) return
    setSaving(true)
    await onSave(pct)
    setSaving(false)
  }

  async function handleRemove() {
    setRemoving(true)
    await onRemove()
    setRemoving(false)
  }

  async function handleRename() {
    const sym = newSymbol.trim().toUpperCase()
    if (!sym || sym === alloc.symbol) { setRenaming(false); return }
    setRenameSaving(true)
    await onRename(sym)
    setRenameSaving(false)
    setRenaming(false)
  }

  return (
    <BottomSheet onClose={onClose}>
      <SheetHeader
        title={
          <div>
            <p>{alloc.symbol}</p>
            {getStockName(alloc.symbol) && (
              <p className="text-footnote" style={{ color: 'var(--text-muted)' }}>{getStockName(alloc.symbol)}</p>
            )}
          </div>
        }
        left={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>}
        right={<button onClick={handleSave} disabled={saving} className="text-accent text-headline font-semibold disabled:opacity-40" style={{ minHeight: 44 }}>{saving ? 'Saving…' : 'Save'}</button>}
      />

        {/* % stepper → slider → plan context */}
        <div className="px-5 pt-5 pb-4 border-b text-center" style={{ borderColor: 'var(--border-faint)' }}>
          {/* Hero % */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setPct(p => Math.max(1, parseFloat((p - 1).toFixed(1))))}
              className="flex items-center justify-center rounded-full text-2xl font-light"
              style={{ width: 44, height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
              −
            </button>
            <div className="flex items-baseline gap-1">
              <input
                type="number" inputMode="decimal"
                value={pct}
                onChange={e => setPct(Math.max(0, parseFloat(e.target.value) || 0))}
                className="font-bold tabnum text-right outline-none bg-transparent"
                style={{ fontSize: 40, width: 72, color: 'var(--text-primary)' }}
              />
              <span className="font-bold" style={{ fontSize: 28, color: 'var(--text-primary)' }}>%</span>
            </div>
            <button
              onClick={() => setPct(p => Math.min(sliderMax, parseFloat((p + 1).toFixed(1))))}
              className="flex items-center justify-center rounded-full text-2xl font-light"
              style={{ width: 44, height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
              +
            </button>
          </div>
          {/* Stock INR amount */}
          <p className="text-subheadline tabnum mt-2.5" style={{ color: 'var(--text-muted)' }}>
            {formatINRFine((pct / 100) * totalBudget)} allocated
          </p>
          {/* Slider */}
          <div className="mt-4 px-1">
            <input
              type="range" min={0} max={sliderMax} step={0.5}
              value={pct}
              onChange={e => setPct(parseFloat(e.target.value))}
              className="w-full accent-accent"
              style={{ height: 4 }}
            />
            <div className="flex justify-between text-footnote mt-1" style={{ color: 'var(--text-faint)' }}>
              <span>0%</span>
              <span>{sliderMax.toFixed(0)}% max</span>
            </div>
          </div>
          {/* Plan context */}
          <div className="mt-3 flex flex-col gap-1">
            <p className="text-footnote font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Plan</p>
            <p className="text-body tabnum" style={{ color: 'var(--text-2)' }}>
              {Math.round(planAllocatedPct)}% allocated
            </p>
            <p className="text-subheadline tabnum" style={{ color: 'var(--text-muted)' }}>
              {formatINRFine(planAllocatedInr)} of {formatINRFine(totalBudget)}
            </p>
          </div>
        </div>

        {/* Category picker */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <p className="text-body">Category</p>
          <select
            value={alloc.category}
            onChange={e => onCategoryChange(e.target.value as StockCategory)}
            className="text-body outline-none text-right"
            style={{ background: 'transparent', color: 'var(--text-2)', maxWidth: 200 }}>
            {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Rename Ticker */}
        {renaming ? (
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
            <p className="text-body" style={{ color: 'var(--text-2)' }}>New Ticker</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newSymbol}
                onChange={e => setNewSymbol(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setRenaming(false); setNewSymbol(alloc.symbol) } }}
                autoFocus
                className="text-body font-semibold text-right outline-none uppercase"
                style={{ color: 'var(--text-primary)', width: 100, border: '1px solid var(--accent)', borderRadius: 8, padding: '4px 8px', background: 'var(--bg-tertiary)' }}
              />
              <button onClick={handleRename}
                disabled={renameSaving || !newSymbol.trim() || newSymbol.trim().toUpperCase() === alloc.symbol}
                className="text-accent text-subheadline font-semibold disabled:opacity-40"
                style={{ background: 'rgba(10,132,255,0.12)', border: '1px solid rgba(10,132,255,0.20)', borderRadius: 8, padding: '4px 12px', minHeight: 32 }}>
                {renameSaving ? '…' : 'Save'}
              </button>
              <button onClick={() => { setRenaming(false); setNewSymbol(alloc.symbol) }}
                className="text-subheadline" style={{ color: 'var(--text-faint)', padding: '0 4px' }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setNewSymbol(alloc.symbol); setRenaming(true) }}
            className="flex items-center justify-between w-full px-5 py-4 border-b"
            style={{ borderColor: 'var(--border-faint)', minHeight: 44 }}>
            <p className="text-body" style={{ color: 'var(--text-2)' }}>Rename Ticker</p>
            <span className="text-body text-accent">›</span>
          </button>
        )}

        {/* Remove */}
        <div className="px-5 pt-4">
          {confirmRemove ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-subheadline" style={{ color: 'var(--text-muted)' }}>Transactions kept</p>
              <button onClick={() => setConfirmRemove(false)}
                className="px-3 rounded-xl text-subheadline"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', minHeight: 44 }}>Keep</button>
              <button onClick={handleRemove} disabled={removing}
                className="px-3 rounded-xl text-subheadline font-semibold text-negative disabled:opacity-40"
                style={{ background: 'rgba(255,59,48,0.10)', minHeight: 44 }}>
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmRemove(true)}
              className="w-full py-3 rounded-xl text-body font-medium text-negative"
              style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.18)' }}>
              Remove from Plan
            </button>
          )}
        </div>
    </BottomSheet>
  )
}

// ── Add stock sheet ───────────────────────────────────────────────────────────

function AddStockSheet({ totalPct, totalBudget, onClose, onAdd }: {
  totalPct: number
  totalBudget: number
  onClose: () => void
  onAdd: (symbol: string, category: StockCategory, pct: number) => Promise<void>
}) {
  const [symbol, setSymbol]     = useState('')
  const [pct, setPct]           = useState(10)
  const [category, setCategory] = useState<StockCategory>('Cap-Light Infra')
  const [saving, setSaving]     = useState(false)
  const kh = useKeyboardHeight()

  const freeWithoutThis  = 100 - totalPct
  const sliderMax        = Math.min(100, freeWithoutThis)
  const planAllocatedPct = totalPct + pct
  const planFreePct      = 100 - planAllocatedPct
  const planAllocatedInr = (planAllocatedPct / 100) * totalBudget
  const planFreeInr      = (planFreePct / 100) * totalBudget

  async function handleAdd() {
    if (!symbol || pct <= 0) return
    setSaving(true)
    await onAdd(symbol, category, pct)
    setSaving(false)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <div className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl sheet-kb"
           style={{ bottom: kh, background: 'var(--bg-secondary)', paddingBottom: kh > 0 ? '8px' : 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>
          <div>
            {symbol
              ? <p className="font-semibold text-headline text-center">{symbol}</p>
              : <p className="font-semibold text-headline text-center">Add Stock</p>
            }
          </div>
          <button onClick={handleAdd} disabled={saving || !symbol || pct <= 0}
            className="text-accent text-headline font-semibold disabled:opacity-40"
            style={{ minHeight: 44 }}>
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>

        {/* Symbol input */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <p className="text-body" style={{ color: 'var(--text-2)' }}>Symbol</p>
          <input
            placeholder="INFY"
            value={symbol}
            onChange={e => {
              const s = e.target.value.toUpperCase()
              setSymbol(s)
              if (DEFAULT_CATEGORY[s]) setCategory(DEFAULT_CATEGORY[s])
            }}
            className="text-body font-semibold text-right outline-none uppercase placeholder:font-normal placeholder:normal-case bg-transparent"
            style={{ color: 'var(--text-primary)', width: 120 }}
            autoFocus
          />
        </div>

        {/* % stepper + slider + plan context */}
        <div className="px-5 pt-5 pb-4 border-b text-center" style={{ borderColor: 'var(--border-faint)' }}>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setPct(p => Math.max(1, parseFloat((p - 1).toFixed(1))))}
              className="flex items-center justify-center rounded-full text-2xl font-light"
              style={{ width: 44, height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
              −
            </button>
            <div className="flex items-baseline gap-1">
              <input
                type="number" inputMode="decimal"
                value={pct}
                onChange={e => setPct(Math.max(0, parseFloat(e.target.value) || 0))}
                className="font-bold tabnum text-right outline-none bg-transparent"
                style={{ fontSize: 40, width: 72, color: 'var(--text-primary)' }}
              />
              <span className="font-bold" style={{ fontSize: 28, color: 'var(--text-primary)' }}>%</span>
            </div>
            <button
              onClick={() => setPct(p => Math.min(sliderMax, parseFloat((p + 1).toFixed(1))))}
              className="flex items-center justify-center rounded-full text-2xl font-light"
              style={{ width: 44, height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
              +
            </button>
          </div>
          <p className="text-subheadline tabnum mt-2.5" style={{ color: 'var(--text-muted)' }}>
            {formatINRFine((pct / 100) * totalBudget)} allocated
          </p>
          <div className="mt-4 px-1">
            <input
              type="range" min={0} max={sliderMax} step={0.5}
              value={pct}
              onChange={e => setPct(parseFloat(e.target.value))}
              className="w-full accent-accent"
              style={{ height: 4 }}
            />
            <div className="flex justify-between text-footnote mt-1" style={{ color: 'var(--text-faint)' }}>
              <span>0%</span>
              <span>{sliderMax.toFixed(0)}% max</span>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <p className="text-footnote font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Plan</p>
            <p className="text-body tabnum" style={{ color: 'var(--text-2)' }}>
              {Math.round(planAllocatedPct)}% allocated
            </p>
            <p className="text-subheadline tabnum" style={{ color: 'var(--text-muted)' }}>
              {formatINRFine(planAllocatedInr)} of {formatINRFine(totalBudget)}
            </p>
          </div>
        </div>

        {/* Category picker */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderColor: 'var(--border-faint)' }}>
          <p className="text-body" style={{ color: 'var(--text-2)' }}>Category</p>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as StockCategory)}
            className="text-body outline-none text-right"
            style={{ background: 'transparent', color: 'var(--text-2)', maxWidth: 200 }}>
            {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
    </>
  )
}

// ── New Plan Sheet ────────────────────────────────────────────────────────────

function NewPlanSheet({ existingFYs, onClose, onCreate }: {
  existingFYs: FiscalYear[]
  onClose: () => void
  onCreate: (fy: FiscalYear) => void
}) {
  const currentYear = new Date().getFullYear()
  const yearRange = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2, currentYear + 3]
  const existingLabels = new Set(existingFYs.map(f => f.label))

  const fyLabel = (yr: number) => `FY${String(yr).slice(-2)}`

  const [selectedYear, setSelectedYear] = useState<number | null>(() => {
    return yearRange.find(y => !existingLabels.has(fyLabel(y))) ?? null
  })
  const [budget, setBudget]             = useState('')
  const [copyStocks, setCopyStocks]     = useState(true)
  const [creating, setCreating]         = useState(false)
  const [error, setError]               = useState('')
  const [sourceFY, setSourceFY]         = useState<FiscalYear | null>(null)
  const [sourceAllocs, setSourceAllocs] = useState<StockAllocation[]>([])
  const [carryoverBySymbol, setCarryoverBySymbol] = useState<Record<string, number>>({})

  const label = selectedYear ? fyLabel(selectedYear) : ''

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

      // Only count buys — sells are tracked separately via unallocated_carryover (redeploy).
      // Using net (buys - sells) would inflate carryover when positions are sold and reinvested.
      const buysBySymbol: Record<string, number> = {}
      for (const t of txns ?? []) {
        if (t.trade_type === 'buy') {
          buysBySymbol[t.symbol] = (buysBySymbol[t.symbol] ?? 0) + t.amount
        }
      }
      const carryover: Record<string, number> = {}
      for (const a of allocs) {
        const stockBudget = (a.allocation_pct / 100) * prior!.total_budget_inr
        const bought = buysBySymbol[a.symbol] ?? 0
        carryover[a.symbol] = stockBudget - bought
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

    // Live check — cached props may be stale if a previous session created this FY
    const { data: alreadyExists } = await sb.from('fiscal_years')
      .select('*').eq('user_id', user.id).eq('label', label).maybeSingle()
    if (alreadyExists) {
      setCreating(false)
      await revalidateFiscalYears()
      onCreate(alreadyExists as FiscalYear)
      return
    }

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
      }))
      await sb.from('stock_allocations').insert(inserts)
    }

    setCreating(false)
    await revalidateFiscalYears()
    onCreate(fy)
  }

  const totalCarryover = Object.values(carryoverBySymbol).reduce((s, v) => s + v, 0)

  return (
    <BottomSheet onClose={onClose} className="overflow-hidden">
      <SheetHeader
        title="New Plan"
        left={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>}
        right={<button onClick={create} disabled={creating} className="text-accent text-headline font-semibold disabled:opacity-40" style={{ minHeight: 44 }}>{creating ? 'Creating…' : 'Create'}</button>}
      />

        <div className="px-5 pt-4 space-y-4">
          {error && (
            <p className="text-negative text-body text-center">{error}</p>
          )}

          <div>
            <p className="text-subheadline mb-2" style={{ color: 'var(--text-muted)' }}>Fiscal Year</p>
            <div className="flex gap-2 flex-wrap">
              {yearRange.map(yr => {
                const taken = existingLabels.has(fyLabel(yr))
                const active = selectedYear === yr
                return (
                  <button key={yr} type="button"
                    onClick={() => !taken && setSelectedYear(yr)}
                    disabled={taken}
                    className="px-4 py-2.5 rounded-xl text-body font-semibold transition-colors disabled:opacity-35"
                    style={active
                      ? { background: 'var(--text-primary)', color: 'var(--bg-primary)' }
                      : { background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                    FY{yr}
                  </button>
                )
              })}
            </div>
            {selectedYear && (
              <p className="text-subheadline mt-1.5" style={{ color: 'var(--text-faint)' }}>
                Apr {selectedYear} – Mar {selectedYear + 1}
              </p>
            )}
          </div>

          <div>
            <p className="text-subheadline mb-1.5" style={{ color: 'var(--text-muted)' }}>Total Budget (₹)</p>
            <input
              type="number" inputMode="decimal" placeholder="2400000"
              value={budget} onChange={e => setBudget(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl text-headline tabnum outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} />
          </div>

          {sourceAllocs.length > 0 && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={copyStocks}
                onChange={e => setCopyStocks(e.target.checked)}
                className="w-5 h-5 rounded accent-accent" />
              <div>
                <p className="text-body">Copy {sourceAllocs.length} stocks from {sourceFY?.label}</p>
                <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>
                  Allocation %s and categories are copied
                  {copyStocks && totalCarryover !== 0 && ` · ${formatINRFine(Math.abs(totalCarryover))} net carryover carried in`}
                  {!copyStocks && totalCarryover !== 0 && ` · ${formatINRFine(Math.abs(totalCarryover))} carryover goes to unallocated`}
                </p>
              </div>
            </label>
          )}

          {totalCarryover !== 0 && copyStocks && (
            <div className="rounded-2xl p-3 space-y-1"
                 style={{ background: 'rgba(48,209,88,0.08)', border: '1px solid rgba(48,209,88,0.2)' }}>
              <p className="text-subheadline font-semibold text-positive">
                Carryover from previous plan
              </p>
              {Object.entries(carryoverBySymbol)
                .filter(([, v]) => v !== 0)
                .sort((a, b) => b[1] - a[1])
                .map(([sym, amt]) => (
                  <div key={sym} className="flex justify-between text-subheadline tabnum">
                    <span style={{ color: 'var(--text-2)' }}>{sym}</span>
                    <span className={amt >= 0 ? 'text-positive' : 'text-negative'}>
                      <Num amount={amt} signed />
                    </span>
                  </div>
                ))}
              <div className={`flex justify-between text-subheadline font-semibold tabnum pt-1 border-t ${totalCarryover >= 0 ? 'text-positive' : 'text-negative'}`}
                   style={{ borderColor: 'rgba(48,209,88,0.2)' }}>
                <span>Net</span>
                <span><Num amount={totalCarryover} signed /></span>
              </div>
            </div>
          )}
        </div>
    </BottomSheet>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ChevronIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

