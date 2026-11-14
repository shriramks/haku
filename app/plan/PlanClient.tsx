'use client'
import { useState, useEffect } from 'react'


import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatUsd, trimPct } from '@/lib/formatter'
import { Num } from '@/components/Num'
import { DEFAULT_CATEGORY, ALL_CATEGORIES, type FiscalYear, type StockAllocation, type StockCategory } from '@/lib/types'
import { SLEEVES, SLEEVE_LABEL, PPF_SYMBOL, allocSleeve, sleevePct, sleeveBudget, rowBudget, round1, pctStep, remainderLine, type Sleeve } from '@/lib/sleeves'
import { SleeveSection, PLAN_COLS } from './SleeveSection'
import { PlanRow, RemainderRow } from './PlanRow'
import { PlanSheet, type PlanSave } from './PlanSheet'
import { PlanFigures } from './PlanFigures'
import { FundPicker } from './FundPicker'
import { fundDisplayName } from '@/lib/fund-name'
import type { MfSchemeResult } from '@/lib/mf-schemes'
import UserMenu from '@/components/UserMenu'
import FYPicker from '@/components/FYPicker'
import { getStockName } from '@/lib/stock-names'
import { isNseExchange } from '@/lib/instrument'
import { revalidateFiscalYears, revalidateAllocations, getAllocationsForFY, getSpentForFY, checkFYHasTxns, getPrevFYCarryover, copyAllocations, lookupInstrument, registerInstrument, type InstrumentLookup } from '@/app/actions'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Button } from '@/components/Button'
import { Stepper } from '@/components/Stepper'
import { ConfirmButtons } from '@/components/ConfirmButtons'
import { LabeledInput } from '@/components/LabeledInput'
import { RowShell, RowSymbol } from '@/components/StockListRow'

interface Props {
  fiscalYears: FiscalYear[]
  initialFY: FiscalYear | null
  initialAllocations: StockAllocation[]
  /** Net invested per symbol in the initial FY (`spent`). */
  initialSpent: Record<string, number>
}

export default function PlanClient({ fiscalYears, initialFY, initialAllocations, initialSpent }: Props) {
  const router = useRouter()
  const [selectedFY, setSelectedFY] = useState(initialFY)
  const [allocations, setAllocations] = useState(initialAllocations)
  const [spent, setSpent] = useState(initialSpent)

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

  async function switchFY(fy: FiscalYear) {
    setSelectedFY(fy)
    setLoading(true)
    router.replace(`/plan?fy=${encodeURIComponent(fy.label)}`)
    const [data, fySpent] = await Promise.all([getAllocationsForFY(fy.id), getSpentForFY(fy.id)])
    setAllocations(data)
    setSpent(fySpent)
    setLoading(false)
  }

  const totalBudget = selectedFY?.total_budget_inr ?? 0

  return (
    <div style={{ minHeight: '100dvh' }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl"
        style={{
          background: 'var(--bg-nav)',
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
        <div className="px-4 py-4" style={{ borderColor: 'var(--border)' }}>
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
        totalBudget={totalBudget}
        spent={spent}
        fyHasTxns={fyHasTxns}
        onSwitchFY={switchFY}
        onAllocationsChange={setAllocations}
        onNewPlan={() => setShowNewPlan(true)}
        onFYChange={(patch) => {
          if (selectedFY) setSelectedFY({ ...selectedFY, ...patch })
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
  fiscalYears, selectedFY, allocations, loading, totalBudget, spent, fyHasTxns,
  onSwitchFY, onAllocationsChange, onNewPlan, onFYChange, onDeleteFY,
}: {
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
  allocations: StockAllocation[]
  loading: boolean
  totalBudget: number
  spent: Record<string, number>
  fyHasTxns: boolean
  onSwitchFY: (fy: FiscalYear) => void
  onAllocationsChange: (allocs: StockAllocation[]) => void
  onNewPlan: () => void
  onFYChange: (patch: Partial<FiscalYear>) => void
  onDeleteFY: () => void
}) {
  const [showPlanSheet, setShowPlanSheet] = useState(false)
  const [editingAlloc, setEditingAlloc] = useState<StockAllocation | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [copying, setCopying] = useState(false)
  const sortedFYs = [...fiscalYears].sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())
  const currentFYIdx = sortedFYs.findIndex(fy => fy.id === selectedFY?.id)
  const prevFY = currentFYIdx > 0 ? sortedFYs[currentFYIdx - 1] : null

  const unallocCarryover = selectedFY?.unallocated_carryover_inr ?? 0
  const effectiveBudget = totalBudget + unallocCarryover

  // A sleeve's rows, largest first; a row's % is of its sleeve (lib/sleeves.ts).
  const rowsOf = (sleeve: Sleeve) => allocations
    .filter(a => allocSleeve(a.kind) === sleeve)
    .sort((a, b) => b.allocation_pct - a.allocation_pct || a.symbol.localeCompare(b.symbol))
  const rowsTotal = (sleeve: Sleeve) => round1(rowsOf(sleeve).reduce((s, a) => s + a.allocation_pct, 0))
  const sleeveAmount = (sleeve: Sleeve) => sleeveBudget(selectedFY, sleeve)
  const hasPPF = allocations.some(a => a.kind === 'ppf')

  // Auto-apply prev FY carryover once the prev FY has ended, if not yet set
  useEffect(() => {
    if (!prevFY || !selectedFY) return
    if (new Date(prevFY.end_date) >= new Date()) return
    if (selectedFY.unallocated_carryover_inr !== null) return // already set
    const prevFYPool = (prevFY.total_budget_inr ?? 0) + (prevFY.unallocated_carryover_inr ?? 0)
    getPrevFYCarryover(prevFY, prevFYPool).then(carryover => {
      getSupabaseBrowser().from('fiscal_years')
        .update({ unallocated_carryover_inr: carryover })
        .eq('id', selectedFY.id)
    })
  }, [prevFY?.id, selectedFY?.id])

  /** Returns an error message to show in the sheet, or null once saved. */
  async function savePlan(patch: PlanSave): Promise<string | null> {
    if (!selectedFY) return null
    const { error } = await getSupabaseBrowser().from('fiscal_years').update(patch).eq('id', selectedFY.id)
    if (error) return error.message
    await revalidateFiscalYears()
    onFYChange(patch)
    setShowPlanSheet(false)
    return null
  }

  async function updateAllocPct(alloc: StockAllocation, pct: number) {
    await getSupabaseBrowser().from('stock_allocations').update({ allocation_pct: pct }).eq('id', alloc.id)
    await revalidateAllocations()
    onAllocationsChange(allocations.map(a => a.id === alloc.id ? { ...a, allocation_pct: pct } : a))
  }

  async function updateAllocCategory(alloc: StockAllocation, category: StockCategory) {
    await getSupabaseBrowser().from('stock_allocations').update({ category }).eq('id', alloc.id)
    await revalidateAllocations()
    onAllocationsChange(allocations.map(a => a.id === alloc.id ? { ...a, category } : a))
  }

  async function removeAlloc(alloc: StockAllocation) {
    await getSupabaseBrowser().from('stock_allocations').delete().eq('id', alloc.id)
    await revalidateAllocations()
    onAllocationsChange(allocations.filter(a => a.id !== alloc.id))
  }

  /** Returns an error message to show in the sheet, or null once the row is added. */
  async function addStock(symbol: string, category: StockCategory, pct: number, yahooSymbol: string | null): Promise<string | null> {
    if (!selectedFY) return null
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return null
    const sym = symbol.toUpperCase()
    let exchange = 'NSE'
    let name: string | undefined
    if (yahooSymbol) {
      // Overseas: the server confirms the ticker with Yahoo and writes the shared master row first.
      const reg = await registerInstrument(sym, yahooSymbol)
      if (!reg.exchange) return reg.error ?? 'Could not add the instrument'
      exchange = reg.exchange
      name = reg.name || undefined
    }
    const { data, error } = await sb.from('stock_allocations').insert({
      fy_id: selectedFY.id, user_id: user.id,
      symbol: sym, exchange, kind: 'stock',
      allocation_pct: pct, category,
    }).select().single()
    if (error || !data) return error?.message ?? 'Could not add the stock'
    await revalidateAllocations()
    const row: StockAllocation = { ...data, name }
    onAllocationsChange([...allocations, row].sort((a, b) => b.allocation_pct - a.allocation_pct))
    setShowAdd(false)
    return null
  }

  /** The PPF row: one per FY, symbol `PPF`, a share of the Debt sleeve. Returns an error message, or null once added. */
  async function addPPF(pct: number): Promise<string | null> {
    if (!selectedFY) return null
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return null
    const { data, error } = await sb.from('stock_allocations').insert({
      fy_id: selectedFY.id, user_id: user.id,
      symbol: PPF_SYMBOL, exchange: 'PPF', kind: 'ppf',
      allocation_pct: pct, category: '',
    }).select().single()
    if (error || !data) return error?.message ?? 'Could not add PPF'
    await revalidateAllocations()
    onAllocationsChange([...allocations, data as StockAllocation])
    setShowAdd(false)
    return null
  }

  /** A debt / arbitrage fund row: symbol is the AMFI scheme code, a share of the Debt sleeve. Returns an error message, or null once added. */
  async function addFund(scheme: MfSchemeResult, pct: number): Promise<string | null> {
    if (!selectedFY) return null
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return null
    const { data, error } = await sb.from('stock_allocations').insert({
      fy_id: selectedFY.id, user_id: user.id,
      symbol: scheme.code, exchange: 'AMFI', kind: 'mf',
      allocation_pct: pct, category: '',
    }).select().single()
    if (error || !data) return error?.message ?? 'Could not add the fund'
    await revalidateAllocations()
    const row: StockAllocation = { ...data, allocation_pct: Number(data.allocation_pct), name: fundDisplayName(scheme.name) }
    onAllocationsChange([...allocations, row].sort((a, b) => b.allocation_pct - a.allocation_pct))
    setShowAdd(false)
    return null
  }

  async function renameAllocSymbol(alloc: StockAllocation, newSymbol: string) {
    const sb = getSupabaseBrowser()
    await sb.from('stock_allocations').update({ symbol: newSymbol }).eq('id', alloc.id)
    await Promise.all([
      sb.from('buy_bands').update({ symbol: newSymbol }).eq('symbol', alloc.symbol),
      sb.from('buy_tranches').update({ symbol: newSymbol }).eq('symbol', alloc.symbol),
    ])
    await revalidateAllocations()
    onAllocationsChange(allocations.map(a => a.id === alloc.id ? { ...a, symbol: newSymbol } : a))
    setEditingAlloc(prev => prev?.id === alloc.id ? { ...prev, symbol: newSymbol } : prev)
  }

  async function clearAllStocks() {
    if (!selectedFY) return
    const sb = getSupabaseBrowser()
    await Promise.all([
      sb.from('stock_allocations').delete().eq('fy_id', selectedFY.id),
    ])
    await revalidateAllocations()
    onAllocationsChange([])
    setConfirmClear(false)
  }

  async function copyFromPrevFY() {
    if (!selectedFY || !prevFY) return
    setCopying(true)
    const copied = await copyAllocations(prevFY.id, selectedFY.id)
    if (copied.rows.length) {
      onAllocationsChange(copied.rows)
      onFYChange({ equity_pct: copied.equity_pct, debt_pct: copied.debt_pct, gold_pct: copied.gold_pct })
    }
    setCopying(false)
  }

  /** The text Export Plan shares: each sleeve, then its rows. */
  function planText(): string {
    const l = (n: number) => `${(n / 100000).toFixed(1)}L`
    const lines: string[] = []
    for (const sleeve of SLEEVES) {
      const rows = rowsOf(sleeve)
      const pct = sleevePct(selectedFY, sleeve)
      if (!rows.length && pct === 0) continue
      lines.push(`${SLEEVE_LABEL[sleeve].toUpperCase().padEnd(10)} ${String(pct).padStart(3)}%   ${l(sleeveAmount(sleeve))}`)
      for (const a of rows) {
        lines.push(`  ${a.symbol.padEnd(8)} ${String(a.allocation_pct).padStart(3)}%   ${l(rowBudget(a.allocation_pct, sleeveAmount(sleeve)))}`)
      }
    }
    return [
      `${selectedFY?.label ?? 'Portfolio'}`,
      '─'.repeat(28),
      ...lines,
      '─'.repeat(28),
      `${'Plan'.padEnd(10)}      ${l(effectiveBudget)}`,
    ].join('\n')
  }

  const editingSleeve = editingAlloc ? allocSleeve(editingAlloc.kind) : 'equity'

  return (
    <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

      {selectedFY ? (
        <>
          {/* Plan line: the pool in one line. The middle says what it is made of; the accent amount is the tap cue
              (no chevron: it opens a sheet, and a chevron means pushing a screen). */}
          <div className="pt-2">
            <button onClick={() => setShowPlanSheet(true)}
              className="w-full grid items-center px-4 tap-row text-left" style={{ gridTemplateColumns: 'auto 1fr auto', columnGap: 12, minHeight: 56 }}>
              <span className="text-title-1 font-bold">Plan</span>
              <span className="text-body tabnum truncate" style={{ color: 'var(--text-2)' }}>
                {unallocCarryover !== 0 && prevFY && (
                  <><Num amount={totalBudget} /> {unallocCarryover < 0 ? '−' : '+'} carryover <Num amount={Math.abs(unallocCarryover)} /></>
                )}
              </span>
              <span className="text-title-1 font-bold tabnum text-accent"><Num amount={effectiveBudget} /></span>
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : (
            <div>
              {/* Column heads — the same grid as every line below */}
              <div className="grid px-4 pt-3" style={{ gridTemplateColumns: PLAN_COLS }}>
                <span />
                <span className="label-field text-center">Share</span>
                <span className="label-field text-right" style={{ paddingRight: 20 }}>Amount</span>
              </div>
              {SLEEVES.map(sleeve => {
                const rows = rowsOf(sleeve)
                const amount = sleeveAmount(sleeve)
                const pct = sleevePct(selectedFY, sleeve)
                const remainder = pct > 0 ? remainderLine(rowsTotal(sleeve), amount) : null
                return (
                  <SleeveSection
                    key={sleeve}
                    sleeve={sleeve}
                    pct={pct}
                    amount={amount}
                    hasRows={rows.length > 0}>
                    {rows.map(alloc => (
                      <PlanRow
                        key={alloc.id}
                        alloc={alloc}
                        budget={rowBudget(alloc.allocation_pct, amount)}
                        onEdit={() => setEditingAlloc(alloc)}
                      />
                    ))}
                    {remainder && <RemainderRow line={remainder} />}
                  </SleeveSection>
                )
              })}
              {(() => {
                const poolRemainder = remainderLine(SLEEVES.reduce((sum, sl) => sum + sleevePct(selectedFY, sl), 0), effectiveBudget)
                return poolRemainder ? <div className="pt-2"><RemainderRow line={poolRemainder} /></div> : null
              })()}

              {/* Add row */}
              {!confirmClear && (
                <button onClick={() => setShowAdd(true)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 tap-row mt-5">
                  <div className="w-6 h-6 rounded-full bg-positive flex items-center justify-center flex-shrink-0">
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M12 4v16m8-8H4"/>
                    </svg>
                  </div>
                  <span className="text-body text-accent">Add to Plan</span>
                </button>
              )}

              {/* Footer rows — Export + Clear All */}
              {allocations.length > 0 && (
                <div className="mt-8">
                  <button
                    onClick={async () => {
                      const text = planText()
                      if (navigator.share) {
                        await navigator.share({ title: `${selectedFY?.label ?? 'Portfolio'} Allocation`, text })
                      } else {
                        await navigator.clipboard.writeText(text)
                      }
                    }}
                    className="w-full text-left px-4 py-4 text-body text-accent tap-row">
                    Export Plan
                  </button>
                  {!confirmClear ? (
                    <button onClick={() => setConfirmClear(true)}
                      className="w-full text-left px-4 py-4 text-body text-negative tap-row">
                      Clear All
                    </button>
                  ) : (
                    <ConfirmButtons
                      className="px-4 py-3"
                      cancelLabel="Cancel" confirmLabel="Remove all?"
                      onCancel={() => setConfirmClear(false)} onConfirm={clearAllStocks}
                      variant="negative"
                    />
                  )}
                </div>
              )}

              {allocations.length === 0 && !showAdd && prevFY && (
                <div className="px-4 pt-4 space-y-2">
                  <button onClick={copyFromPrevFY} disabled={copying}
                    className="w-full py-3 rounded-2xl text-body font-semibold disabled:opacity-40"
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                    {copying ? 'Copying…' : `Copy plan from ${prevFY.label}`}
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

      {showAdd && selectedFY && (
        <AddToPlanSheet
          hasPPF={hasPPF}
          fundCodes={new Set(allocations.filter(a => a.kind === 'mf').map(a => a.symbol))}
          equityTotal={rowsTotal('equity')}
          equityAmount={sleeveAmount('equity')}
          debtTotal={rowsTotal('debt')}
          debtAmount={sleeveAmount('debt')}
          spent={spent}
          onClose={() => setShowAdd(false)}
          onAddStock={addStock}
          onAddPPF={addPPF}
          onAddFund={addFund}
        />
      )}

      {showPlanSheet && selectedFY && (
        <PlanSheet
          fy={selectedFY}
          fyHasTxns={fyHasTxns}
          prevFYLabel={prevFY?.label}
          onClose={() => setShowPlanSheet(false)}
          onSave={savePlan}
          onDeleteFY={() => { setShowPlanSheet(false); onDeleteFY() }}
        />
      )}

      {editingAlloc && (
        <StockEditSheet
          alloc={editingAlloc}
          sleeve={editingSleeve}
          totalBudget={sleeveAmount(editingSleeve)}
          totalPct={rowsTotal(editingSleeve)}
          invested={spent[editingAlloc.symbol] ?? 0}
          onClose={() => setEditingAlloc(null)}
          onSave={async (pct) => { await updateAllocPct(editingAlloc, pct); setEditingAlloc(null) }}
          onCategoryChange={async (cat) => { await updateAllocCategory(editingAlloc, cat); setEditingAlloc({ ...editingAlloc, category: cat }) }}
          onRemove={async () => { await removeAlloc(editingAlloc); setEditingAlloc(null) }}
          onRename={async (newSym) => { await renameAllocSymbol(editingAlloc, newSym) }}
        />
      )}
    </div>
  )
}

// ── Stock edit sheet ──────────────────────────────────────────────────────────

function StockEditSheet({ alloc, sleeve, totalBudget, totalPct, invested, onClose, onSave, onCategoryChange, onRemove, onRename }: {
  alloc: StockAllocation
  /** The sleeve the row sits in: its amount is `totalBudget`, and `totalPct` is the sum of its rows' %. */
  sleeve: Sleeve
  totalBudget: number
  totalPct: number
  /** Net invested in this stock this FY (`spent`). */
  invested: number
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

  const sliderMax    = round1(Math.min(100, 100 - totalPct + alloc.allocation_pct))
  const wasBudget    = (alloc.allocation_pct / 100) * totalBudget
  const nowBudget    = (pct / 100) * totalBudget
  const nowPlanPct   = round1(totalPct - alloc.allocation_pct + pct)

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
            <p>{alloc.kind === 'mf' ? (alloc.name ?? alloc.symbol) : alloc.symbol}</p>
            {alloc.kind !== 'mf' && (alloc.kind === 'ppf' ? 'Public Provident Fund' : (alloc.name ?? getStockName(alloc.symbol))) && (
              <p className="text-footnote" style={{ color: 'var(--text-muted)' }}>{alloc.kind === 'ppf' ? 'Public Provident Fund' : (alloc.name ?? getStockName(alloc.symbol))}</p>
            )}
          </div>
        }
        left={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>}
        right={<Button variant="secondary" onClick={handleSave} loading={saving} style={{ minHeight: 44 }}>Save</Button>}
      />

        {/* % stepper → slider → figures */}
        <div className="px-5 pt-5 pb-2 text-center">
          <Stepper value={pct} min={0.1} max={sliderMax} step={0.1} onChange={setPct} suffix="%" />
          <div className="mt-4 px-1">
            <input
              type="range" min={0} max={sliderMax} step={pctStep(sliderMax)}
              value={pct}
              onChange={e => setPct(parseFloat(e.target.value))}
              className="w-full accent-accent"
              style={{ height: 4 }}
            />
            <div className="flex justify-between text-footnote mt-1" style={{ color: 'var(--text-faint)' }}>
              <span>0%</span>
              <span>{trimPct(sliderMax)}% max</span>
            </div>
          </div>
        </div>
        <PlanFigures withWas rows={[
          { label: 'Planned',   was: { amount: wasBudget }, now: { amount: nowBudget } },
          { label: 'Invested',  now: { amount: invested } },
          { label: 'Left',      was: { amount: wasBudget - invested }, now: { amount: nowBudget - invested }, tone: true },
          { label: `${SLEEVE_LABEL[sleeve]} total`, now: { pct: nowPlanPct }, gap: true, tone: true },
        ]} />

        {/* Category picker (stocks only) */}
        {alloc.kind === 'stock' && <div className="flex items-center justify-between px-5 py-4">
          <p className="text-body">Category</p>
          <select
            value={alloc.category}
            onChange={e => onCategoryChange(e.target.value as StockCategory)}
            className="text-body outline-none text-right"
            style={{ background: 'transparent', color: 'var(--text-2)', maxWidth: 200 }}>
            {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>}

        {/* Rename Ticker */}
        {alloc.kind !== 'stock' || !isNseExchange(alloc.exchange) ? null : renaming ? (
          <div className="flex items-center justify-between px-5 py-4">
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
            className="flex items-center justify-between w-full px-5 py-4"
            style={{ minHeight: 44 }}>
            <p className="text-body" style={{ color: 'var(--text-2)' }}>Rename Ticker</p>
            <span className="text-body text-accent">›</span>
          </button>
        )}

        {/* Remove */}
        <div className="px-5 pt-4">
          {confirmRemove ? (
            <ConfirmButtons
              message="Transactions kept"
              cancelLabel="Keep" confirmLabel="Remove"
              onCancel={() => setConfirmRemove(false)} onConfirm={handleRemove}
              variant="negative" loading={removing}
            />
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

// ── Add to Plan (one sheet; Type: Equity | Debt) ──────────────────────────────

type AddType = 'equity' | 'debt'

/** Under Debt: what is added, a PPF row or a fund. Same segmented control as Type. */
function InstrumentControl({ value, onChange }: { value: 'ppf' | 'fund'; onChange: (i: 'ppf' | 'fund') => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <p className="text-body" style={{ color: 'var(--text-2)' }}>Instrument</p>
      <div className="flex rounded-xl p-0.5" style={{ background: 'var(--bg-tertiary)' }}>
        {(['ppf', 'fund'] as const).map(i => (
          <button key={i} onClick={() => onChange(i)}
            className="text-body font-semibold rounded-xl px-4"
            style={{
              minHeight: 36,
              background: value === i ? 'var(--bg-secondary)' : 'transparent',
              color: value === i ? 'var(--text-primary)' : 'var(--text-2)',
            }}>
            {i === 'ppf' ? 'PPF' : 'Fund'}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The Type control, same segmented control as Market. */
function TypeControl({ options, value, onChange }: {
  options: AddType[]
  value: AddType
  onChange: (t: AddType) => void
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <p className="text-body" style={{ color: 'var(--text-2)' }}>Type</p>
      <div className="flex rounded-xl p-0.5" style={{ background: 'var(--bg-tertiary)' }}>
        {options.map(t => (
          <button key={t} onClick={() => onChange(t)}
            className="text-body font-semibold rounded-xl px-4"
            style={{
              minHeight: 36,
              background: value === t ? 'var(--bg-secondary)' : 'transparent',
              color: value === t ? 'var(--text-primary)' : 'var(--text-2)',
            }}>
            {SLEEVE_LABEL[t]}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The one Add entry point. Type picks what is added — Equity a stock, Debt the PPF row — and only the body of the
 * sheet changes: it is one component with one shell, so switching Type does not re-open (re-slide) the sheet.
 * A type with nothing left to add is not offered.
 */
function AddToPlanSheet({ hasPPF, fundCodes, equityTotal, equityAmount, debtTotal, debtAmount, spent, onClose, onAddStock, onAddPPF, onAddFund }: {
  hasPPF: boolean
  /** AMFI scheme codes already in this FY's plan. */
  fundCodes: Set<string>
  /** Sum of the Equity rows' % (of the sleeve), and the sleeve's amount. */
  equityTotal: number
  equityAmount: number
  /** The same for Debt. */
  debtTotal: number
  debtAmount: number
  spent: Record<string, number>
  onClose: () => void
  /** Resolves to an error message to show here, or null once added. `yahooSymbol` is set for an overseas instrument. */
  onAddStock: (symbol: string, category: StockCategory, pct: number, yahooSymbol: string | null) => Promise<string | null>
  onAddPPF: (pct: number) => Promise<string | null>
  onAddFund: (scheme: MfSchemeResult, pct: number) => Promise<string | null>
}) {
  const types: AddType[] = ['equity', 'debt']
  const [type, setType]         = useState<AddType>('equity')
  const [switched, setSwitched] = useState(false)   // the symbol field only grabs focus when the sheet opens, not on a Type switch
  const isDebt = type === 'debt'

  // Equity: a stock
  const [symbol, setSymbol]     = useState('')
  const [pct, setPct]           = useState(10)
  const [category, setCategory] = useState<StockCategory>('Cap-Light Infra')
  const [market, setMarket]     = useState<'IND' | 'Other'>('IND')
  const [yahoo, setYahoo]       = useState('')
  const [lookup, setLookup]     = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'ok'; instrument: InstrumentLookup } | { status: 'error'; error: string }
  >({ status: 'idle' })
  // Debt: the PPF row, or a fund (PPF is offered only while there is no PPF row)
  const [instrument, setInstrument] = useState<'ppf' | 'fund'>(hasPPF ? 'fund' : 'ppf')
  const [fund, setFund]         = useState<MfSchemeResult | null>(null)
  const isFund = isDebt && (hasPPF || instrument === 'fund')
  const debtMax = round1(Math.min(100, Math.max(0, 100 - debtTotal)))
  const [ppfPct, setPPFPct]     = useState(Math.min(10, debtMax))

  const [saving, setSaving]     = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const kh = useKeyboardHeight()
  const overseas = market === 'Other'

  // Quote-checks the typed Yahoo symbol once typing pauses; a stale answer is dropped.
  useEffect(() => {
    if (isDebt || !overseas) return
    const ys = yahoo.trim()
    if (!ys) { setLookup({ status: 'idle' }); return }
    setLookup({ status: 'loading' })
    let stale = false
    const timer = setTimeout(async () => {
      const r = await lookupInstrument(ys)
      if (stale) return
      setLookup(r.instrument ? { status: 'ok', instrument: r.instrument } : { status: 'error', error: r.error ?? 'No quote found' })
    }, 600)
    return () => { stale = true; clearTimeout(timer) }
  }, [isDebt, overseas, yahoo])

  // An overseas symbol is the Yahoo ticker's base (VUAA.L -> VUAA), so it is typed once.
  const shownSymbol = overseas ? yahoo.trim().toUpperCase().split('.')[0] : symbol
  const equityMax = round1(Math.min(100, 100 - equityTotal))

  // The % control (stepper + slider) and its figures are shared; they read whichever type is showing.
  const sliderMax = isDebt ? debtMax : equityMax
  const value     = isDebt ? ppfPct : pct
  const setValue  = isDebt ? setPPFPct : setPct
  const step      = pctStep(sliderMax)
  const budget    = rowBudget(value, isDebt ? debtAmount : equityAmount)
  const invested  = isFund ? (fund ? spent[fund.code] ?? 0 : 0) : isDebt ? (spent[PPF_SYMBOL] ?? 0) : (spent[shownSymbol] ?? 0)
  const nowTotal  = round1((isDebt ? debtTotal : equityTotal) + value)
  const canAdd    = isFund ? (!!fund && value > 0) : isDebt ? value > 0 : (!!shownSymbol && pct > 0 && (!overseas || lookup.status === 'ok'))

  async function handleAdd() {
    if (!canAdd) return
    setSaving(true)
    setAddError(null)
    const error = isFund
      ? await onAddFund(fund!, ppfPct)
      : isDebt
      ? await onAddPPF(ppfPct)
      : await onAddStock(shownSymbol, category, pct, overseas ? yahoo.trim().toUpperCase() : null)
    if (error) setAddError(error)
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
        <div className="flex items-center justify-between px-5 pt-2 pb-4">
          <button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>
          <p className="font-semibold text-headline text-center">{isFund ? (fund ? fundDisplayName(fund.name) : 'Add Fund') : isDebt ? 'PPF' : (shownSymbol || 'Add Stock')}</p>
          <Button variant="secondary" onClick={handleAdd} loading={saving} disabled={!canAdd} style={{ minHeight: 44 }}>
            Add
          </Button>
        </div>

        {types.length > 1 && (
          <TypeControl options={types} value={type} onChange={t => { setType(t); setSwitched(true); setAddError(null) }} />
        )}

        {isDebt && !hasPPF && (
          <InstrumentControl value={instrument} onChange={i => { setInstrument(i); setAddError(null) }} />
        )}

        {isFund && (fund ? (
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <p className="text-body" style={{ color: 'var(--text-2)' }}>Fund</p>
            <div className="flex items-center gap-3 min-w-0">
              <p className="text-body font-semibold truncate">{fundDisplayName(fund.name)}</p>
              <button type="button" onClick={() => setFund(null)} className="text-subheadline flex-shrink-0 text-accent" style={{ minHeight: 44 }}>Change</button>
            </div>
          </div>
        ) : (
          <FundPicker inPlan={fundCodes} onPick={s => { setFund(s); setAddError(null) }} />
        ))}

        {!isDebt && (
          <>
            {/* Symbol input (IND only: an overseas symbol comes from its Yahoo ticker) */}
            {!overseas && <div className="flex items-center justify-between px-5 py-4">
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
                autoFocus={!switched}
              />
            </div>}

            {/* Market: an Indian listing is resolved automatically; anything else needs its Yahoo symbol */}
            <div className="flex items-center justify-between px-5 py-4">
              <p className="text-body" style={{ color: 'var(--text-2)' }}>Market</p>
              <div className="flex rounded-xl p-0.5" style={{ background: 'var(--bg-tertiary)' }}>
                {(['IND', 'Other'] as const).map(m => (
                  <button key={m} onClick={() => { setMarket(m); setAddError(null) }}
                    className="text-body font-semibold rounded-xl px-4"
                    style={{
                      minHeight: 36,
                      background: market === m ? 'var(--bg-secondary)' : 'transparent',
                      color: market === m ? 'var(--text-primary)' : 'var(--text-2)',
                    }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {overseas && (
              <>
                <div className="flex items-center justify-between px-5 py-4">
                  <p className="text-body" style={{ color: 'var(--text-2)' }}>Yahoo symbol</p>
                  <input
                    placeholder="VUAA.L"
                    value={yahoo}
                    onChange={e => {
                      const y = e.target.value.toUpperCase()
                      setYahoo(y)
                      setAddError(null)
                      const base = y.split('.')[0]
                      if (DEFAULT_CATEGORY[base]) setCategory(DEFAULT_CATEGORY[base])
                    }}
                    className={`text-body font-semibold text-right outline-none uppercase placeholder:font-normal bg-transparent${lookup.status === 'error' ? ' text-negative' : ''}`}
                    style={{ color: lookup.status === 'error' ? undefined : 'var(--text-primary)', width: 140 }}
                  />
                </div>
                {lookup.status === 'loading' && (
                  <div className="px-5 py-3"><p className="text-body" style={{ color: 'var(--text-2)' }}>Checking</p></div>
                )}
                {lookup.status === 'error' && (
                  <div className="px-5 py-3"><p className="text-body text-negative">{lookup.error}</p></div>
                )}
                {lookup.status === 'ok' && (
                  <div className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-headline font-semibold truncate">{lookup.instrument.name || lookup.instrument.yahooSymbol}</p>
                      <p className="text-subheadline" style={{ color: 'var(--text-2)' }}>{lookup.instrument.exchange}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-headline font-semibold tabnum">{formatUsd(lookup.instrument.price)}</p>
                      <p className="text-subheadline" style={{ color: 'var(--text-2)' }}>{lookup.instrument.currency}</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* % stepper + slider + figures */}
        {(!isFund || fund) && <div className="px-5 pt-5 pb-2 text-center">
          <Stepper value={value} min={0.1} max={sliderMax} step={0.1} onChange={setValue} suffix="%" />
          <div className="mt-4 px-1">
            <input
              type="range" min={0} max={sliderMax} step={step}
              value={value}
              onChange={e => setValue(parseFloat(e.target.value))}
              className="w-full accent-accent"
              style={{ height: 4 }}
            />
            <div className="flex justify-between text-footnote mt-1" style={{ color: 'var(--text-faint)' }}>
              <span>0%</span>
              <span>{trimPct(sliderMax)}% max</span>
            </div>
          </div>
        </div>}
        {(!isFund || fund) && <PlanFigures rows={[
          { label: 'Planned',   now: { amount: budget } },
          { label: 'Invested',  now: { amount: invested } },
          { label: 'Left',      now: { amount: budget - invested }, tone: true },
          { label: isDebt ? 'Debt total' : 'Equity total', now: { pct: nowTotal }, gap: true, tone: true },
        ]} />}

        {/* Category picker (a stock has one; PPF does not) */}
        {!isDebt && <div className="flex items-center justify-between px-5 py-4">
          <p className="text-body" style={{ color: 'var(--text-2)' }}>Category</p>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as StockCategory)}
            className="text-body outline-none text-right"
            style={{ background: 'transparent', color: 'var(--text-2)', maxWidth: 200 }}>
            {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>}

        {addError && <div className="px-5 py-3"><p className="text-body text-negative">{addError}</p></div>}
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

  const label = selectedYear ? fyLabel(selectedYear) : ''

  // When the user picks a year, find the chronologically prior FY and fetch its allocations
  useEffect(() => {
    if (!selectedYear) return
    const newStart = new Date(`${selectedYear}-04-01`)
    const sorted = [...existingFYs]
      .filter(fy => new Date(fy.start_date) < newStart)
      .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())
    const prior = sorted[0] ?? null
    setSourceFY(prior)
    setSourceAllocs([])

    if (!prior) return

    const sb = getSupabaseBrowser()
    sb.from('stock_allocations').select('id, fy_id, symbol, exchange, kind, allocation_pct, category').eq('fy_id', prior.id)
      .then(({ data }) => { if (data?.length) setSourceAllocs(data) })
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
      .select('id, label, start_date, end_date, total_budget_inr, unallocated_carryover_inr, deploy_capital_inr, equity_pct, debt_pct, gold_pct')
      .eq('user_id', user.id).eq('label', label).maybeSingle()
    if (alreadyExists) {
      setCreating(false)
      await revalidateFiscalYears()
      onCreate(alreadyExists as FiscalYear)
      return
    }

    const { data: fy, error: fyErr } = await sb.from('fiscal_years').insert({
      user_id: user.id,
      label,
      start_date: dates.start,
      end_date: dates.end,
      total_budget_inr: parseFloat(budget),
      unallocated_carryover_inr: null,
      // The split travels with the copied rows; a plan started empty is all Equity (the column defaults).
      ...(copyStocks && sourceAllocs.length > 0 && sourceFY
        ? { equity_pct: sourceFY.equity_pct, debt_pct: sourceFY.debt_pct, gold_pct: sourceFY.gold_pct }
        : {}),
    }).select().single()

    if (fyErr || !fy) { setError(fyErr?.message ?? 'Failed to create plan'); setCreating(false); return }

    if (copyStocks && sourceAllocs.length > 0) {
      await sb.from('stock_allocations').insert(sourceAllocs.map(a => ({
        fy_id: fy.id, user_id: user.id,
        symbol: a.symbol, exchange: a.exchange, kind: a.kind,
        allocation_pct: a.allocation_pct, category: a.category,
      })))
    }

    setCreating(false)
    await revalidateFiscalYears()
    onCreate(fy)
  }

  return (
    <BottomSheet onClose={onClose} className="overflow-hidden">
      <SheetHeader
        title="New Plan"
        left={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>}
        right={<Button variant="secondary" onClick={create} loading={creating} style={{ minHeight: 44 }}>Create</Button>}
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

          <LabeledInput
            label="Total budget"
            value={budget}
            onChange={setBudget}
            placeholder="2400000"
          />

          {sourceAllocs.length > 0 && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={copyStocks}
                onChange={e => setCopyStocks(e.target.checked)}
                className="w-5 h-5 rounded accent-accent" />
              <div>
                <p className="text-body">Copy {sourceAllocs.length} rows from {sourceFY?.label}</p>
                <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>
                  Allocation %s and categories are copied
                </p>
              </div>
            </label>
          )}
        </div>
    </BottomSheet>
  )
}
