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

// ── Advance Tax ───────────────────────────────────────────────────────────────

export function InstalmentsBody({
  results, isOpen, annualLiability, onEdit,
}: {
  results:         InstalmentResult[]
  isOpen:          boolean
  annualLiability: number
  onEdit:          (r: InstalmentResult) => void
}) {
  const firstUpcomingIdx = results.findIndex(r => !r.isPast)

  return (
    <div className="pb-2">
      <SectionHeader title="Advance Tax" />
      {results.map((r, i) => (
        <MilestoneRow key={r.milestone.key} result={r} highlight={isOpen && i === firstUpcomingIdx} onTap={() => onEdit(r)} />
      ))}
      <div className="px-4 pt-2">
        <DetailRow label="Total tax so far this FY" muted noRupee><Num amount={annualLiability} align /></DetailRow>
      </div>
    </div>
  )
}

function MilestoneRow({ result, highlight, onTap }: { result: InstalmentResult; highlight: boolean; onTap: () => void }) {
  const { milestone, isPast, target, paid, interest } = result
  const due = Math.max(0, target - paid)

  let meta: string
  let dueLabel: string | null = null
  if (isPast) {
    meta = due > 0
      ? `Paid ${formatINRFine(paid)}${interest > 0 ? ` · +${formatINRFine(interest)} interest` : ''}`
      : `Paid ${formatINRFine(paid)} · paid in full`
  } else {
    meta = `Paid ${formatINRFine(paid)}`
    const days = Math.round((Date.parse(milestone.date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000)
    dueLabel = highlight ? `due in ${days}d` : 'not yet due'
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
        {dueLabel && (
          <span className="text-footnote font-semibold" style={{ color: highlight ? 'var(--accent)' : 'var(--text-faint)' }}>{dueLabel}</span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 items-end flex-shrink-0 ml-3" style={{ minWidth: 76 }}>
        <span className="text-headline font-bold tabnum" style={{ color: 'var(--text-primary)' }}><Num amount={due} align /></span>
        <span className="text-footnote" style={{ color: 'var(--text-faint)' }}>{due > 0 ? 'to pay' : 'settled'}</span>
      </div>
    </button>
  )
}

// ── Total Tax ────────────────────────────────────────────────────────────────

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
      <SectionHeader title="Total Tax" right={<SlabRateSelect value={slabRatePct} onChange={onSlabRateChange} />} />

      {rows.map(r => (
        <div key={r.bucket}>
          <SectionLabel label={`${r.label} · ${r.rateLabel}`} className="px-4" />
          <DetailRow label="Raw gain" noRupee><Num amount={r.rawGain} signed align /></DetailRow>
          {r.exemption > 0 && <DetailRow label="Exemption" muted noRupee><Num amount={-r.exemption} align /></DetailRow>}
          {r.setOff > 0 && <DetailRow label="Loss set off" muted noRupee><Num amount={-r.setOff} align /></DetailRow>}
          <DetailRow label="Taxable" bold noRupee><Num amount={r.taxable} signed align /></DetailRow>
          {r.tax !== null && <DetailRow label="Tax" noRupee><Num amount={r.tax} align /></DetailRow>}
          {r.bucket === 'debtLTCG' && (
            <p className="px-4 pb-2 pt-1 text-footnote" style={{ color: 'var(--text-faint)' }}>
              Includes gold ETF sold before maturity. Shown at purchase cost — indexation not computed, verify with your CA.
            </p>
          )}
        </div>
      ))}

      <SectionLabel label={`Dividends · ${dividendRateLabel}`} className="px-4" />
      <DetailRow label="Taxable" bold noRupee><Num amount={dividendIncome} signed align /></DetailRow>
      <DetailRow label="Tax" noRupee><Num amount={dividendTax} align /></DetailRow>

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
      <DetailRow label="Tax" noRupee><Num amount={tax} align /></DetailRow>
      <DetailRow label="Cess @ 4%" noRupee><Num amount={cess} align /></DetailRow>
      <DetailRow label="Tax + Cess" bold noRupee><Num amount={total} align /></DetailRow>
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
      <DetailRow label="Tax + Cess" noRupee><Num amount={taxPlusCess} align /></DetailRow>
      <DetailRow label="Dividend TDS credit" muted noRupee><Num amount={-tdsCredit} align /></DetailRow>
      <DetailRow label="Advance tax paid" muted noRupee><Num amount={-advancePaid} align /></DetailRow>
      <div className="px-4 pt-3 pb-1">
        <p className="text-footnote font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Net Payable</p>
        <p className="text-title-1 font-bold tabnum" style={{ marginTop: 2, color: 'var(--text-primary)' }}>
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
      <DetailRow label="Annual limit" muted noRupee><span>1.25<span className="num-u"> L</span></span></DetailRow>
      <DetailRow label="Used" noRupee><Num amount={exemptionUsed} align /></DetailRow>
      <DetailRow label="Remaining" bold noRupee><Num amount={remaining} align /></DetailRow>
      <div className="px-4 pb-3 pt-1">
        <ProgressBar percent={barPct} />
      </div>

      <SectionLabel label="Unrealised Losses" className="px-4" />
      <DetailRow label="Harvestable now" bold noRupee>
        {pricesLoading
          ? <span style={{ color: 'var(--text-faint)' }}>—</span>
          : unrealisedLoss !== null && unrealisedLoss < 0
            ? <Num amount={unrealisedLoss} signed align />
            : <span style={{ color: 'var(--text-faint)' }}>None</span>
        }
      </DetailRow>
    </div>
  )
}
