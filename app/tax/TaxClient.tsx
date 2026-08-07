'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { FiscalYear, Transaction, DividendTransaction, AdvanceTaxPaidRow, CarryForwardDbRow } from '@/lib/types'
import type { MFund, MFTransaction, SGBTransaction } from '@/lib/portfolio-types'
import { gatherBucketedGains, computeStockGains, computeMFGains, computeGoldGains, mfAssetClass, groupBy, netStockQty, LTCG_DAYS_DEBT } from '@/lib/tax-compute'
import type { RealisedGain, UnrealisedPosition } from '@/lib/tax-compute'
import { bucketGains, applySetOff, computeTax, dividendTDS, sumCarryForward } from '@/lib/tax-liability'
import type { CarryForwardRow, Bucket } from '@/lib/tax-liability'
import { advanceTaxMilestones, computeInstalments, shouldSuppressInstalments, buildLiabilityAsOf } from '@/lib/advance-tax'
import type { InstalmentResult, MilestoneKey, AdvanceTaxPaid } from '@/lib/advance-tax'
import { planCarryForwardReconciliation } from '@/lib/tax-reconcile'
import { todayISO, formatINRFine } from '@/lib/formatter'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'
import FYPicker from '@/components/FYPicker'
import UserMenu from '@/components/UserMenu'
import { Button } from '@/components/Button'
import { DEFAULT_SLAB_RATE } from '@/components/SlabRateSelect'
import { Section, InstalmentsBody, TaxBody, HarvestingBody } from './TaxSections'
import type { SectionKey, TaxBucketRow, GoldEtfSummary } from './TaxSections'

interface Props {
  fiscalYears:    FiscalYear[]
  currentFY:      FiscalYear | null
  stockTxns:      Transaction[]
  mfFunds:        MFund[]
  mfTxns:         MFTransaction[]
  sgbTxns:        SGBTransaction[]
  dividends:      DividendTransaction[]
  advanceTaxPaid: AdvanceTaxPaidRow[]
  carryForward:   CarryForwardDbRow[]
}

const BUCKET_ORDER: Bucket[] = ['equityLTCG', 'equitySTCG', 'debtLTCG', 'debtSTCG']
const BUCKET_LABEL: Record<Bucket, string> = {
  equityLTCG: 'Equity LTCG', equitySTCG: 'Equity STCG', debtLTCG: 'Debt LTCG', debtSTCG: 'Debt STCG',
}

export default function TaxClient({
  fiscalYears, currentFY, stockTxns, mfFunds, mfTxns, sgbTxns, dividends, advanceTaxPaid, carryForward,
}: Props) {
  const router = useRouter()
  const [selectedFY, setSelectedFY]   = useState<FiscalYear | null>(currentFY)
  const [slabRatePct, setSlabRatePct] = useState(DEFAULT_SLAB_RATE)
  const [expanded, setExpanded]       = useState<Set<SectionKey>>(new Set(['advance']))
  const [cmps, setCmps]               = useState<Record<string, number>>({})
  const [navs, setNavs]               = useState<Record<string, number>>({})
  const [pricesLoading, setPricesLoading] = useState(true)
  const pricesFetchedRef              = useRef(false)

  const [paidRows, setPaidRows] = useState<AdvanceTaxPaidRow[]>(advanceTaxPaid)
  const [cfRows, setCfRows]     = useState<CarryForwardDbRow[]>(carryForward)
  const reconcileRef            = useRef(false)

  const [editingMilestone, setEditingMilestone] = useState<InstalmentResult | null>(null)

  function toggle(key: SectionKey) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const stockMap = useMemo(() => groupBy(stockTxns, t => t.symbol),    [stockTxns])
  const mfMap    = useMemo(() => groupBy(mfTxns,    t => t.fund_id),   [mfTxns])
  const goldMap  = useMemo(() => groupBy(sgbTxns,   t => t.gold_type), [sgbTxns])

  const fyById = useMemo(() => new Map(fiscalYears.map(fy => [fy.id, fy])), [fiscalYears])
  const carryForwardLibRows: CarryForwardRow[] = useMemo(() =>
    cfRows.map(r => ({ id: r.id, fyStartDate: fyById.get(r.fy_id)?.start_date ?? '', lossType: r.loss_type, remaining: r.remaining })),
    [cfRows, fyById])

  // Fetch live prices once — only for equity positions (stock + equity MF),
  // the only ones Harvesting's unrealised-loss figure needs.
  useEffect(() => {
    if (pricesFetchedRef.current) return
    pricesFetchedRef.current = true

    const fetches: Promise<void>[] = []
    const stockSymbols = [...new Set(stockTxns.map(t => t.symbol))]
    if (stockSymbols.length > 0) {
      fetches.push(
        fetch(`/api/cmp/batch?symbols=${encodeURIComponent(stockSymbols.join(','))}`)
          .then(r => r.json())
          .then(d => { if (d.prices) setCmps(d.prices) })
          .catch(() => {})
      )
    }
    for (const fund of mfFunds.filter(f => mfAssetClass(f) === 'equity')) {
      fetches.push(
        fetch(`https://api.mfapi.in/mf/${fund.scheme_code}`)
          .then(r => r.json())
          .then(d => {
            const nav = parseFloat(d.data?.[0]?.nav)
            if (!isNaN(nav)) setNavs(prev => ({ ...prev, [fund.scheme_code]: nav }))
          })
          .catch(() => {})
      )
    }
    Promise.allSettled(fetches).then(() => setPricesLoading(false))
  }, [stockTxns, mfFunds])

  // Reconcile the carryforward ledger once per load — chains every closed FY
  // that has no row yet, oldest first, so incoming carryforward is correct
  // regardless of which FYs were viewed before. See lib/tax-reconcile.ts.
  useEffect(() => {
    if (reconcileRef.current) return
    reconcileRef.current = true

    const plan = planCarryForwardReconciliation({
      fiscalYears, existingRows: carryForwardLibRows, stockMap, mfMap, mfFunds, goldMap, asOfToday: todayISO(),
    })
    if (plan.decrements.length === 0 && plan.upserts.length === 0) return

    async function persist() {
      const sb = getSupabaseBrowser()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return

      for (const dec of plan.decrements) {
        await sb.from('capital_loss_carryforward').update({ remaining: dec.newRemaining }).eq('id', dec.id)
      }

      const byFyStart = new Map(fiscalYears.map(fy => [fy.start_date, fy.id]))
      const newRows: CarryForwardDbRow[] = []
      for (const u of plan.upserts) {
        const fyId = byFyStart.get(u.fyStartDate)
        if (!fyId) continue
        const { data } = await sb.from('capital_loss_carryforward')
          .upsert({ user_id: user.id, fy_id: fyId, loss_type: u.lossType, amount: u.amount, remaining: u.remaining }, { onConflict: 'user_id,fy_id,loss_type' })
          .select('id, fy_id, loss_type, remaining')
          .single()
        if (data) newRows.push(data as CarryForwardDbRow)
      }

      setCfRows(prev => {
        const decById = new Map(plan.decrements.map(d => [d.id, d.newRemaining]))
        const updated = prev.map(r => decById.has(r.id) ? { ...r, remaining: decById.get(r.id)! } : r)
        return [...updated, ...newRows]
      })
    }
    persist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fyRange = useMemo(() => selectedFY ? { start: selectedFY.start_date, end: selectedFY.end_date } : null, [selectedFY])

  const computed = useMemo(() => {
    if (!fyRange) return { equity: [] as RealisedGain[], debt: [] as RealisedGain[], dividendIncome: 0 }
    const asOf = todayISO()
    const { equity, debt } = gatherBucketedGains({ stockMap, mfMap, mfFunds, goldMap, fyRange, asOf })
    const dividendIncome = dividends
      .filter(d => d.ex_date >= fyRange.start && d.ex_date <= fyRange.end)
      .reduce((s, d) => s + d.amount, 0)
    return { equity, debt, dividendIncome }
  }, [fyRange, stockMap, mfMap, goldMap, mfFunds, dividends])

  const raw = useMemo(() => bucketGains(computed.equity, computed.debt), [computed])

  // Gold ETF's own LTCG/STCG, for the informational Breakdown group only —
  // it's already counted inside raw.debtLTCG/debtSTCG above (same bucket,
  // same rate mechanics per #77); this doesn't feed the tax pipeline twice.
  const goldEtf: GoldEtfSummary = useMemo(() => {
    if (!fyRange) return { hasActivity: false, ltcg: 0, stcg: 0 }
    const etfTxns = goldMap.get('etf')
    if (!etfTxns) return { hasActivity: false, ltcg: 0, stcg: 0 }
    const { realised } = computeGoldGains(etfTxns, 'etf', null, fyRange, todayISO(), LTCG_DAYS_DEBT)
    let ltcg = 0, stcg = 0
    for (const g of realised) { if (g.gainType === 'LTCG') ltcg += g.gain; else stcg += g.gain }
    return { hasActivity: realised.length > 0, ltcg, stcg }
  }, [fyRange, goldMap])

  const incomingCarryForward = useMemo(() => {
    if (!selectedFY) return { shortTerm: 0, longTerm: 0 }
    return sumCarryForward(carryForwardLibRows.filter(r => r.fyStartDate < selectedFY.start_date))
  }, [carryForwardLibRows, selectedFY])

  const setOff     = useMemo(() => applySetOff(raw, incomingCarryForward, slabRatePct), [raw, incomingCarryForward, slabRatePct])
  const taxResult  = useMemo(() => computeTax(setOff.final, computed.dividendIncome, slabRatePct), [setOff, computed.dividendIncome, slabRatePct])
  const tds        = dividendTDS(computed.dividendIncome)

  const paidRow = useMemo(() => selectedFY ? paidRows.find(r => r.fy_id === selectedFY.id) : undefined, [paidRows, selectedFY])
  const paid: AdvanceTaxPaid = {
    jun: paidRow?.jun ?? 0, sep: paidRow?.sep ?? 0, dec: paidRow?.dec ?? 0, mar: paidRow?.mar ?? 0,
  }
  const advancePaidTotal = paid.jun + paid.sep + paid.dec + paid.mar

  const instalments = useMemo(() => {
    if (!selectedFY) return [] as InstalmentResult[]
    const milestones     = advanceTaxMilestones(selectedFY)
    const liabilityAsOf  = buildLiabilityAsOf({ stockMap, mfMap, mfFunds, goldMap, dividends, fyStart: selectedFY.start_date, incomingCarryForward, slabRatePct })
    return computeInstalments(milestones, liabilityAsOf, paid, todayISO())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFY, stockMap, mfMap, mfFunds, goldMap, dividends, incomingCarryForward, slabRatePct, paid.jun, paid.sep, paid.dec, paid.mar])

  const annualLiability     = taxResult.total - tds
  const suppressInstalments = shouldSuppressInstalments(annualLiability)
  const payable              = annualLiability - advancePaidTotal

  const taxRows: TaxBucketRow[] = useMemo(() => BUCKET_ORDER.map(bucket => {
    const setOffAmt = setOff.moves.filter(m => m.to === bucket).reduce((s, m) => s + m.amount, 0)
    const exemption = bucket === 'equityLTCG' ? setOff.exemptionApplied : 0
    const line      = taxResult.lines.find(l => l.bucket === bucket)
    const rateLabel = bucket === 'equitySTCG' ? '20%' : bucket === 'debtSTCG' ? `${slabRatePct}% slab` : '12.5%'
    return {
      bucket, label: BUCKET_LABEL[bucket], rateLabel,
      rawGain: raw[bucket], exemption, setOff: setOffAmt,
      taxable: setOff.final[bucket], tax: line ? line.tax : null,
    }
  }), [raw, setOff, taxResult, slabRatePct])

  const setOffLines = useMemo(() => {
    if (setOff.moves.length === 0) return [] as string[]
    const groups = new Map<string, { total: number; dests: Map<Bucket, number> }>()
    for (const m of setOff.moves) {
      const g = groups.get(m.from) ?? { total: 0, dests: new Map<Bucket, number>() }
      g.total += m.amount
      g.dests.set(m.to, (g.dests.get(m.to) ?? 0) + m.amount)
      groups.set(m.from, g)
    }
    return [...groups.entries()].map(([from, g]) => {
      const destStr = [...g.dests.entries()].map(([b, amt]) => `${formatINRFine(amt)} to ${BUCKET_LABEL[b]}`).join(', ')
      if (from === 'carryForwardLong' || from === 'carryForwardShort') {
        const lossType = from === 'carryForwardLong' ? 'long' : 'short'
        const sources = [...new Set(
          carryForwardLibRows
            .filter(r => r.lossType === lossType && selectedFY && r.fyStartDate < selectedFY.start_date && r.remaining > 0)
            .sort((a, b) => a.fyStartDate < b.fyStartDate ? -1 : 1)
            .map(r => fiscalYears.find(fy => fy.start_date === r.fyStartDate)?.label ?? r.fyStartDate)
        )].join(', ') || 'a prior FY'
        return `${formatINRFine(g.total)} ${lossType}-term carryforward from ${sources} used: ${destStr}.`
      }
      return `${formatINRFine(g.total)} ${BUCKET_LABEL[from as Bucket]} loss set off: ${destStr}.`
    })
  }, [setOff, carryForwardLibRows, selectedFY, fiscalYears])

  const newCarryForwardLine = useMemo(() => {
    const { shortTerm, longTerm } = setOff.newCarryForward
    const parts: string[] = []
    if (shortTerm > 0) parts.push(`${formatINRFine(shortTerm)} short-term`)
    if (longTerm > 0) parts.push(`${formatINRFine(longTerm)} long-term`)
    return parts.length === 0 ? null : `Carried to next FY: ${parts.join(', ')}.`
  }, [setOff])

  const harvestingData = useMemo(() => {
    if (!fyRange) return { unrealisedLoss: null as number | null }
    const asOf = todayISO()
    const positions: UnrealisedPosition[] = []
    for (const [symbol, txns] of stockMap) {
      if (netStockQty(txns) <= 0) continue
      positions.push(...computeStockGains(txns, symbol, cmps[symbol] ?? null, fyRange, asOf).unrealised)
    }
    for (const [fundId, txns] of mfMap) {
      const fund = mfFunds.find(f => f.id === fundId)
      if (fund && mfAssetClass(fund) === 'debt') continue
      const nav = fund ? navs[fund.scheme_code] ?? null : null
      positions.push(...computeMFGains(txns, fundId, 'equity', null, nav, fyRange, asOf).unrealised)
    }
    const pricesAvailable = Object.keys(cmps).length > 0 || Object.keys(navs).length > 0
    const unrealisedLoss = pricesAvailable
      ? positions.filter(p => p.gain !== null && p.gain < 0).reduce((s, p) => s + (p.gain ?? 0), 0)
      : null
    return { unrealisedLoss }
  }, [fyRange, stockMap, mfMap, mfFunds, cmps, navs])

  async function savePaid(fy: FiscalYear, key: MilestoneKey, amount: number) {
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const existing = paidRows.find(r => r.fy_id === fy.id)
    const payload = {
      user_id: user.id, fy_id: fy.id,
      jun: existing?.jun ?? 0, sep: existing?.sep ?? 0, dec: existing?.dec ?? 0, mar: existing?.mar ?? 0,
      [key]: amount,
    }
    const { data } = await sb.from('advance_tax_paid')
      .upsert(payload, { onConflict: 'user_id,fy_id' })
      .select('id, fy_id, jun, sep, dec, mar')
      .single()
    if (data) {
      const row = data as AdvanceTaxPaidRow
      setPaidRows(prev => {
        const idx = prev.findIndex(r => r.fy_id === fy.id)
        if (idx === -1) return [...prev, row]
        const next = [...prev]; next[idx] = row; return next
      })
    }
  }

  return (
    <div style={{ background: 'var(--bg-primary)', minHeight: '100dvh', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl border-b px-4 pb-3"
           style={{ background: 'var(--bg-nav)', borderColor: 'var(--border-faint)', paddingTop: 'max(env(safe-area-inset-top,0px), 16px)' }}>
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1">
            <button
              onClick={() => router.push('/portfolio')}
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 32, height: 32, marginLeft: -6, color: 'var(--accent)' }}
              aria-label="Back to Portfolio">
              <svg width="10" height="16" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M7 1L1 7l6 6" />
              </svg>
            </button>
            <h1 className="text-display font-bold">Tax</h1>
          </div>
          <div className="flex items-center gap-2">
            <FYPicker fiscalYears={fiscalYears} selectedFY={selectedFY} onSelect={setSelectedFY} />
            <UserMenu />
          </div>
        </div>
      </div>

      {selectedFY && !suppressInstalments && (
        <Section title="Advance Tax" sectionKey="advance" expanded={expanded} onToggle={toggle}>
          <InstalmentsBody results={instalments} onEdit={setEditingMilestone} />
        </Section>
      )}

      <Section title="Total Tax" sectionKey="tax" expanded={expanded} onToggle={toggle}>
        <TaxBody
          rows={taxRows}
          goldEtf={goldEtf}
          dividendIncome={computed.dividendIncome}
          dividendRateLabel={`${slabRatePct}% slab`}
          dividendTax={taxResult.lines.find(l => l.bucket === 'dividends')?.tax ?? 0}
          setOffLines={setOffLines}
          newCarryForwardLine={newCarryForwardLine}
          tax={taxResult.tax}
          cess={taxResult.cess}
          tdsCredit={tds}
          advancePaid={advancePaidTotal}
          payable={payable}
          slabRatePct={slabRatePct}
          onSlabRateChange={setSlabRatePct}
        />
      </Section>

      <Section title="Harvesting" sectionKey="harvesting" expanded={expanded} onToggle={toggle}>
        <HarvestingBody
          exemptionUsed={setOff.exemptionApplied}
          unrealisedLoss={harvestingData.unrealisedLoss}
          pricesLoading={pricesLoading}
        />
      </Section>

      {editingMilestone && selectedFY && (
        <PaidAmountSheet
          result={editingMilestone}
          onClose={() => setEditingMilestone(null)}
          onSave={amount => savePaid(selectedFY, editingMilestone.milestone.key, amount)}
        />
      )}
    </div>
  )
}

// ── Edit paid-amount sheet ───────────────────────────────────────────────────

function PaidAmountSheet({ result, onClose, onSave }: {
  result: InstalmentResult
  onClose: () => void
  onSave: (amount: number) => Promise<void>
}) {
  const [value, setValue]   = useState(result.paid ? String(result.paid) : '')
  const [saving, setSaving] = useState(false)
  const kh = useKeyboardHeight()

  // Lock body scroll while the sheet is open — matches AddTxnModal. Without
  // this, iOS auto-scrolls the page to keep the focused input visible at the
  // same time this sheet's own `bottom: kh` offset repositions it — the two
  // fight each other and split the sheet across the screen.
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

  async function handleSave() {
    setSaving(true)
    await onSave(parseFloat(value) || 0)
    setSaving(false)
    onClose()
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
          <p className="font-semibold text-headline">{result.milestone.label}</p>
          <Button variant="secondary" onClick={handleSave} loading={saving} style={{ minHeight: 44 }}>Save</Button>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <p className="text-body">Paid so far</p>
          <input
            type="number" inputMode="decimal"
            value={value} onChange={e => setValue(e.target.value)}
            className="text-headline font-semibold tabnum text-right outline-none rounded-xl px-3 py-1.5 w-36"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            autoFocus
          />
        </div>
      </div>
    </>
  )
}
