'use client'
import type { InstalmentResult } from '@/lib/advance-tax'
import type { Bucket } from '@/lib/tax-liability'
import { LTCG_EXEMPTION } from '@/lib/tax-liability'
import { Num } from '@/components/Num'
import { DetailRow, SectionLabel } from '@/components/detail-rows'
import { ProgressBar } from '@/components/ProgressBar'
import { ChevronDownIcon } from '@/components/icons'
import { formatINRFine } from '@/lib/formatter'
import SlabRateSelect from '@/components/SlabRateSelect'

export type SectionKey = 'advance' | 'tax' | 'harvesting'

// ── Collapsible section — same pattern as the rest of the app. No border —
// sections are separated by spacing and the header label itself, per
// docs/design.md ("groups are separated by SectionDividers — text labels —
// ... not by background colour changes or rounded containers"). ───────────

export function Section({
  title, sectionKey, expanded, onToggle, children,
}: {
  title:      string
  sectionKey: SectionKey
  expanded:   Set<SectionKey>
  onToggle:   (k: SectionKey) => void
  children:   React.ReactNode
}) {
  const isOpen = expanded.has(sectionKey)
  return (
    <div style={{ marginTop: 24 }}>
      <button
        onClick={() => onToggle(sectionKey)}
        className="flex items-center justify-between w-full px-4 tap-row"
        style={{ minHeight: 48 }}>
        <span className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <ChevronDownIcon
          className="w-4 h-4 transition-transform"
          style={{ color: 'var(--text-faint)', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
      </button>
      {isOpen && children}
    </div>
  )
}

// ── Advance Tax — plain list ─────────────────────────────────────────────────

export function InstalmentsBody({
  results, onEdit,
}: {
  results: InstalmentResult[]
  onEdit:  (r: InstalmentResult) => void
}) {
  return (
    <div>
      {results.map((r, i) => (
        <MilestoneRow
          key={r.milestone.key}
          result={r}
          priorInterest={i > 0 ? results[i - 1].interest : 0}
          onTap={() => onEdit(r)}
        />
      ))}
    </div>
  )
}

// `target` and `paid` are both cumulative-to-date by design (paid tracks
// "cumulative amount paid by this milestone's due date" per the DB schema),
// so `target - paid` already correctly folds in anything missed at an
// earlier milestone — it's the true amount to pay right now to be caught
// up, not just this quarter's own slice. Shown as the primary figure, with
// the cumulative target itself as secondary context: target - paid(left) =
// amountDue(right) is meant to be directly verifiable from the row alone.
//
// s.234C interest is assessed independently per quarter (never retroactive,
// per #81), but it isn't paid "at" the quarter that caused it — that
// quarter's due date has already passed by the time the shortfall is known.
// It's shown as a carry-over on the *next* row instead of the row whose own
// shortfall produced it.
function MilestoneRow({ result, priorInterest, onTap }: {
  result: InstalmentResult; priorInterest: number; onTap: () => void
}) {
  const { milestone, isPast, target, paid } = result
  const amountDue = Math.max(0, target - paid)

  const parts: string[] = []
  if (isPast || paid > 0) {
    parts.push(`Paid ${formatINRFine(paid)}`)
    if (isPast && amountDue <= 0) parts.push('paid in full')
  }
  if (priorInterest > 0) parts.push(`+${formatINRFine(priorInterest)} interest`)
  const meta = parts.length > 0 ? parts.join(' · ') : null

  return (
    <button
      onClick={onTap}
      className="flex items-center justify-between w-full px-4 tap-row"
      style={{ minHeight: 56 }}>
      <div className="flex flex-col gap-0.5 items-start min-w-0">
        <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{milestone.label}</span>
        {meta && <span className="text-footnote" style={{ color: 'var(--text-faint)' }}>{meta}</span>}
      </div>
      <div className="flex flex-col gap-0.5 items-end flex-shrink-0 ml-3">
        <span className="text-headline font-bold tabnum" style={{ color: 'var(--text-primary)' }}><Num amount={amountDue} align /></span>
        {/* Only shown when it differs from amountDue — when paid is 0,
            amountDue === target exactly, so this would just repeat the
            headline number. */}
        {paid > 0 && <span className="text-footnote" style={{ color: 'var(--text-faint)' }}>{formatINRFine(target)} target</span>}
      </div>
    </button>
  )
}

// ── Total Tax — answer first (slab select, Tax/Cess/TDS/Paid/Net Payable),
// then a Breakdown of every bucket that feeds it. ───────────────────────────

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

export interface GoldEtfSummary {
  hasActivity: boolean
  ltcg:        number
  stcg:        number
}

export function TaxBody({
  rows, goldEtf, dividendIncome, dividendRateLabel, dividendTax,
  setOffLines, newCarryForwardLine,
  tax, cess, tdsCredit, advancePaid, payable,
  slabRatePct, onSlabRateChange,
}: {
  rows:                TaxBucketRow[]
  goldEtf:             GoldEtfSummary
  dividendIncome:      number
  dividendRateLabel:   string
  dividendTax:         number
  setOffLines:         string[]
  newCarryForwardLine: string | null
  tax:                 number
  cess:                number
  tdsCredit:           number
  advancePaid:         number
  payable:             number
  slabRatePct:         number
  onSlabRateChange:    (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-4" style={{ minHeight: 44, paddingTop: 8 }}>
        <span className="text-body" style={{ color: 'var(--text-2)' }}>Slab Rate</span>
        <SlabRateSelect value={slabRatePct} onChange={onSlabRateChange} />
      </div>

      <DetailRow label="Tax" noRupee><Num amount={tax} align /></DetailRow>
      <DetailRow label="Cess @ 4%" noRupee><Num amount={cess} align /></DetailRow>
      <DetailRow label="Dividend TDS credit" muted noRupee><Num amount={-tdsCredit} align /></DetailRow>
      <DetailRow label="Advance tax paid" muted noRupee><Num amount={-advancePaid} align /></DetailRow>
      <DetailRow label="Net Payable" bold noRupee><Num amount={payable} signed align /></DetailRow>

      <SectionLabel label="Breakdown" className="px-4" />

      {rows.map(r => (
        <div key={r.bucket}>
          <SectionLabel label={`${r.label} · ${r.rateLabel}`} className="px-4" />
          <DetailRow label="Raw gain" noRupee><Num amount={r.rawGain} signed align /></DetailRow>
          {r.exemption > 0 && <DetailRow label="Exemption" muted noRupee><Num amount={-r.exemption} align /></DetailRow>}
          {r.setOff > 0 && <DetailRow label="Loss set off" muted noRupee><Num amount={-r.setOff} align /></DetailRow>}
          <DetailRow label="Taxable" bold noRupee><Num amount={r.taxable} signed align /></DetailRow>
          {r.tax !== null && <DetailRow label="Tax" noRupee><Num amount={r.tax} align /></DetailRow>}
        </div>
      ))}

      {goldEtf.hasActivity && (
        <>
          <SectionLabel label="Gold ETF" className="px-4" />
          <DetailRow label="LTCG" bold noRupee><Num amount={goldEtf.ltcg} signed align /></DetailRow>
          <DetailRow label="STCG" bold noRupee><Num amount={goldEtf.stcg} signed align /></DetailRow>
        </>
      )}

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
    <div>
      <SectionLabel label="Equity LTCG Exemption" className="px-4" />
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
