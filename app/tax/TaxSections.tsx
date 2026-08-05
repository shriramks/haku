'use client'
import type { InstalmentResult } from '@/lib/advance-tax'
import type { Bucket } from '@/lib/tax-liability'
import { LTCG_EXEMPTION } from '@/lib/tax-liability'
import { Num } from '@/components/Num'
import { DetailRow, SectionLabel } from '@/components/detail-rows'
import { ProgressBar } from '@/components/ProgressBar'
import { formatINRFine } from '@/lib/formatter'
import SlabRateSelect from '@/components/SlabRateSelect'

// ── Fixed section header — no chevron, no collapse ──────────────────────────

export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4" style={{ minHeight: 44, marginTop: 22 }}>
      <span className="text-title-2 font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
      {right}
    </div>
  )
}

// ── Next Due / Instalments ───────────────────────────────────────────────────

export function InstalmentsBody({
  title, results, isOpen, onEdit,
}: {
  title:   string
  results: InstalmentResult[]
  isOpen:  boolean
  onEdit:  (r: InstalmentResult) => void
}) {
  const firstUpcomingIdx = results.findIndex(r => !r.isPast)

  return (
    <div className="pb-2">
      <SectionHeader title={title} />
      {results.map((r, i) => (
        <MilestoneRow key={r.milestone.key} result={r} highlight={isOpen && i === firstUpcomingIdx} onTap={() => onEdit(r)} />
      ))}
    </div>
  )
}

function MilestoneRow({ result, highlight, onTap }: { result: InstalmentResult; highlight: boolean; onTap: () => void }) {
  const { milestone, isPast, target, paid, shortfall, interest } = result

  let meta: string
  let due: string | null = null
  if (isPast) {
    meta = shortfall > 0
      ? `Paid ${formatINRFine(paid)} · shortfall ${formatINRFine(shortfall)}${interest > 0 ? ` · +${formatINRFine(interest)} interest` : ''}`
      : `Paid ${formatINRFine(paid)} · paid in full`
  } else {
    meta = `Paid ${formatINRFine(paid)}`
    const days = Math.round((Date.parse(milestone.date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000)
    due = highlight ? `due in ${days}d` : 'not yet due'
  }

  return (
    <button
      onClick={onTap}
      className="flex items-center justify-between w-full tap-row"
      style={{
        padding: highlight ? '10px 8px' : '10px 16px',
        margin: highlight ? '0 8px' : undefined,
        minHeight: 56,
        borderRadius: highlight ? 12 : undefined,
        background: highlight ? 'color-mix(in srgb, var(--accent) 7%, transparent)' : undefined,
      }}>
      <div className="flex flex-col gap-0.5 items-start min-w-0">
        <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{milestone.label}</span>
        <span className="text-footnote" style={{ color: 'var(--text-faint)' }}>{meta}</span>
        {due && (
          <span className="text-footnote font-semibold" style={{ color: highlight ? 'var(--accent)' : 'var(--text-faint)' }}>{due}</span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 items-end flex-shrink-0 ml-3">
        <span className="text-headline font-bold tabnum" style={{ color: 'var(--text-primary)' }}><Num amount={target} /></span>
        <span className="text-footnote" style={{ color: 'var(--text-faint)' }}>target</span>
      </div>
    </button>
  )
}

// ── Realised (gains or losses) ───────────────────────────────────────────────

export function RealisedBody({
  equityLTCG, equitySTCG, debtLTCG, debtSTCG, dividendIncome,
}: {
  equityLTCG: number; equitySTCG: number; debtLTCG: number; debtSTCG: number; dividendIncome: number
}) {
  return (
    <div className="pb-2">
      <SectionHeader title="Realised" />

      <SectionLabel label="Equity" className="px-4" />
      <DetailRow label="LTCG" bold noRupee><Num amount={equityLTCG} signed /></DetailRow>
      <DetailRow label="STCG" bold noRupee><Num amount={equitySTCG} signed /></DetailRow>

      <SectionLabel label="Debt" className="px-4" />
      <DetailRow label="LTCG" bold noRupee><Num amount={debtLTCG} signed /></DetailRow>
      <DetailRow label="STCG" bold noRupee><Num amount={debtSTCG} signed /></DetailRow>
      <p className="px-4 pb-2 pt-1 text-footnote" style={{ color: 'var(--text-faint)' }}>
        Includes gold ETF sold before maturity. Shown at purchase cost — indexation not computed, verify with your CA.
      </p>

      <SectionLabel label="Dividends" className="px-4" />
      <DetailRow label="Received" bold noRupee><Num amount={dividendIncome} signed /></DetailRow>
    </div>
  )
}

// ── Tax ──────────────────────────────────────────────────────────────────────

export interface TaxBucketRow {
  bucket:    Bucket
  label:     string
  rateLabel: string
  rawGain:   number
  exemption: number
  setOff:    number
  taxable:   number
  tax:       number | null
}

export function TaxBody({
  rows, dividendIncome, dividendRateLabel, dividendTax,
  setOffLines, newCarryForwardLine,
  tax, cess, total,
  slabRatePct, onSlabRateChange,
}: {
  rows:                TaxBucketRow[]
  dividendIncome:      number
  dividendRateLabel:   string
  dividendTax:         number
  setOffLines:         string[]
  newCarryForwardLine: string | null
  tax:                 number
  cess:                number
  total:               number
  slabRatePct:         number
  onSlabRateChange:    (v: number) => void
}) {
  return (
    <div className="pb-2">
      <SectionHeader title="Tax" right={<SlabRateSelect value={slabRatePct} onChange={onSlabRateChange} />} />

      {rows.map(r => (
        <div key={r.bucket}>
          <SectionLabel label={`${r.label} · ${r.rateLabel}`} className="px-4" />
          {(r.exemption > 0 || r.setOff > 0) && (
            <DetailRow label="Raw gain" noRupee><Num amount={r.rawGain} signed /></DetailRow>
          )}
          {r.exemption > 0 && <DetailRow label="Exemption" muted noRupee><Num amount={-r.exemption} /></DetailRow>}
          {r.setOff > 0 && <DetailRow label="Loss set off" muted noRupee><Num amount={-r.setOff} /></DetailRow>}
          <DetailRow label="Taxable" bold noRupee><Num amount={r.taxable} signed /></DetailRow>
          {r.tax !== null && <DetailRow label="Tax" noRupee><Num amount={r.tax} /></DetailRow>}
        </div>
      ))}

      <SectionLabel label={`Dividends · ${dividendRateLabel}`} className="px-4" />
      <DetailRow label="Taxable" bold noRupee><Num amount={dividendIncome} signed /></DetailRow>
      <DetailRow label="Tax" noRupee><Num amount={dividendTax} /></DetailRow>

      {setOffLines.length > 0 && (
        <>
          <SectionLabel label="Set-off" className="px-4" />
          {setOffLines.map((line, i) => (
            <p key={i} className="px-4 pb-1.5 text-footnote" style={{ color: 'var(--text-muted)' }}>{line}</p>
          ))}
        </>
      )}

      {newCarryForwardLine && (
        <p className="px-4 pb-1.5 pt-1 text-footnote" style={{ color: 'var(--text-muted)' }}>{newCarryForwardLine}</p>
      )}

      <SectionLabel label="Total" className="px-4" />
      <DetailRow label="Tax" noRupee><Num amount={tax} /></DetailRow>
      <DetailRow label="Cess @ 4%" noRupee><Num amount={cess} /></DetailRow>
      <DetailRow label="Tax + Cess" bold noRupee><Num amount={total} /></DetailRow>
    </div>
  )
}

// ── Payable ──────────────────────────────────────────────────────────────────

export function PayableBody({
  taxPlusCess, tdsCredit, advancePaid, payable,
}: {
  taxPlusCess: number; tdsCredit: number; advancePaid: number; payable: number
}) {
  return (
    <div className="pb-2">
      <SectionHeader title="Payable" />
      <DetailRow label="Tax + Cess" noRupee><Num amount={taxPlusCess} /></DetailRow>
      <DetailRow label="Dividend TDS credit" muted noRupee><Num amount={-tdsCredit} /></DetailRow>
      <DetailRow label="Advance tax paid" muted noRupee><Num amount={-advancePaid} /></DetailRow>
      <div className="px-4 pt-2 pb-1">
        <p className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Net Payable</p>
        <p className="text-display font-bold tabnum" style={{ marginTop: 4, color: 'var(--text-primary)' }}>
          <Num amount={payable} signed />
        </p>
      </div>
    </div>
  )
}

// ── Harvesting ───────────────────────────────────────────────────────────────

export function HarvestingBody({
  exemptionUsed, unrealisedLoss, pricesLoading,
}: {
  exemptionUsed:  number
  unrealisedLoss: number | null
  pricesLoading:  boolean
}) {
  const remaining = LTCG_EXEMPTION - exemptionUsed
  const barPct    = Math.min(100, Math.max(0, (exemptionUsed / LTCG_EXEMPTION) * 100))

  return (
    <div className="pb-2">
      <SectionHeader title="Harvesting" />

      <SectionLabel label="LTCG Exemption" className="px-4" />
      <DetailRow label="Used" noRupee>{formatINRFine(exemptionUsed)} of 1.25<span className="num-u"> L</span></DetailRow>
      <DetailRow label="Remaining" bold noRupee><Num amount={remaining} /></DetailRow>
      <div className="px-4 pb-3 pt-1">
        <ProgressBar percent={barPct} />
      </div>

      <SectionLabel label="Unrealised Losses" className="px-4" />
      <DetailRow label="Harvestable now" bold noRupee>
        {pricesLoading
          ? <span style={{ color: 'var(--text-faint)' }}>—</span>
          : unrealisedLoss !== null && unrealisedLoss < 0
            ? <Num amount={unrealisedLoss} signed />
            : <span style={{ color: 'var(--text-faint)' }}>None</span>
        }
      </DetailRow>
    </div>
  )
}
