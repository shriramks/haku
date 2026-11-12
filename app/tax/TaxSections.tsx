'use client'
import type { InstalmentResult, InstalmentShare } from '@/lib/advance-tax'
import type { Bucket } from '@/lib/tax-liability'
import { LTCG_EXEMPTION } from '@/lib/tax-liability'
import { Num } from '@/components/Num'
import { DetailRow, SectionLabel } from '@/components/detail-rows'
import { ProgressBar } from '@/components/ProgressBar'
import { ChevronRightIcon, ShareIcon } from '@/components/icons'
import { formatINRFine } from '@/lib/formatter'
import type { SurchargeBracket } from '@/lib/tax-liability'

export type SectionKey = 'advance' | 'tax' | 'harvesting'

// ── Collapsible section — same header as Portfolio's SectionHeader: `.list-row`
// (56px), bold headline label, the section's hero value on the right, a right
// chevron that rotates down when open. No border; spacing is set by the page. ─

export function Section({
  title, sectionKey, expanded, onToggle, value, children,
}: {
  title:      string
  sectionKey: SectionKey
  expanded:   Set<SectionKey>
  onToggle:   (k: SectionKey) => void
  value:      React.ReactNode
  children:   React.ReactNode
}) {
  const isOpen = expanded.has(sectionKey)
  return (
    <div>
      <button
        onClick={() => onToggle(sectionKey)}
        className="flex items-center justify-between w-full px-4 list-row tap-row">
        <span className="text-headline font-bold" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <span className="flex items-center gap-2.5">
          <span className="text-headline font-semibold tabnum" style={{ color: 'var(--text-2)' }}>{value}</span>
          <ChevronRightIcon
            className="w-4 h-4 transition-transform duration-150"
            style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none' }}
          />
        </span>
      </button>
      {isOpen && children}
    </div>
  )
}

// ── Advance Tax — one row per due date ───────────────────────────────────────
// Payments pool and fill quarters oldest-first (`allocatePayments`,
// lib/advance-tax.ts), so a catch-up logged under Sep still shows Jun as paid.
// No status colours: a covered quarter is muted, everything else full contrast.

export function InstalmentsBody({
  results, shares, onEdit,
}: {
  results: InstalmentResult[]
  shares:  InstalmentShare[]
  onEdit:  (r: InstalmentResult) => void
}) {
  return (
    <div>
      {results.map((r, i) => (
        <MilestoneRow key={r.milestone.key} result={r} share={shares[i]} onTap={() => onEdit(r)} />
      ))}
    </div>
  )
}

// Four fixed columns, same on every row, no column heads (each cell carries its
// own small word): date | due <this quarter's share> | paid <what was logged on
// this date> | pay <what to pay now>. A past row is faded whole (colour, never
// opacity) and has no `pay`: nothing is paid on a date that has gone, and any
// shortfall is already inside the NEXT upcoming quarter's `pay` (own share +
// earlier unpaid + interest). Later upcoming quarters show their own remaining
// share. The date never wraps.
const ROW_GRID: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '48px 1fr 1fr 1fr', columnGap: 6, alignItems: 'baseline',
}

function Cell({ word, children, strong }: { word: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <span className="tabnum text-right whitespace-nowrap">
      <span className="text-subheadline" style={{ color: 'var(--text-2)' }}>{word}</span>{' '}
      <span className={strong ? 'text-headline font-bold' : 'text-body'}>{children}</span>
    </span>
  )
}

function MilestoneRow({ result, share, onTap }: {
  result: InstalmentResult; share: InstalmentShare; onTap: () => void
}) {
  const { milestone, ownPaid } = result
  const { status, slice, payable } = share
  const past = status !== 'upcoming'
  return (
    <button onClick={onTap} className="w-full px-4 tap-row list-row text-left"
            style={{ ...ROW_GRID, color: past ? 'var(--text-2)' : 'var(--text-primary)' }}>
      <span className="text-headline font-semibold whitespace-nowrap">{milestone.label}</span>
      <Cell word="due"><Num amount={slice} /></Cell>
      <Cell word="paid"><Num amount={ownPaid} /></Cell>
      {!past && payable >= 0.5 ? <Cell word="pay" strong><Num amount={payable} /></Cell> : <span />}
    </button>
  )
}

// ── Total Tax — answer first (Tax/Cess/TDS/Paid/Net Payable),
// then a Breakdown of every bucket that feeds it. ───────────────────────────

const SURCHARGE_LABEL: Record<SurchargeBracket, string> = { NONE: '', S10: '10%', S15: '15%', S25: '25%' }

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
  tax, surcharge, surchargeBracket, cess, tdsCredit, advancePaid, payable, onShare,
}: {
  rows:                TaxBucketRow[]
  goldEtf:             GoldEtfSummary
  dividendIncome:      number
  dividendRateLabel:   string
  dividendTax:         number
  setOffLines:         string[]
  newCarryForwardLine: string | null
  tax:                 number
  surcharge:           number
  surchargeBracket:    SurchargeBracket
  cess:                number
  tdsCredit:           number
  advancePaid:         number
  payable:             number
  onShare:             () => void
}) {
  return (
    <div>
      <DetailRow label="Tax"><Num amount={tax} align /></DetailRow>
      {surchargeBracket !== 'NONE' && (
        <DetailRow label={`Surcharge @ ${SURCHARGE_LABEL[surchargeBracket]}`}><Num amount={surcharge} align /></DetailRow>
      )}
      <DetailRow label="Cess @ 4%"><Num amount={cess} align /></DetailRow>
      <DetailRow label="Dividend TDS credit" muted><Num amount={-tdsCredit} align /></DetailRow>
      <DetailRow label="Advance tax paid" muted><Num amount={-advancePaid} align /></DetailRow>
      <DetailRow label="Net Payable" bold><Num amount={payable} signed align /></DetailRow>

      <SectionLabel label="Breakdown" className="px-4" />

      {rows.map(r => (
        <div key={r.bucket}>
          <SectionLabel label={`${r.label} · ${r.rateLabel}`} className="px-4" />
          <DetailRow label="Raw gain"><Num amount={r.rawGain} signed align /></DetailRow>
          {r.exemption > 0 && <DetailRow label="Exemption" muted><Num amount={-r.exemption} align /></DetailRow>}
          {r.setOff > 0 && <DetailRow label="Loss set off" muted><Num amount={-r.setOff} align /></DetailRow>}
          <DetailRow label="Taxable" bold><Num amount={r.taxable} signed align /></DetailRow>
          {r.tax !== null && <DetailRow label="Tax"><Num amount={r.tax} align /></DetailRow>}
        </div>
      ))}

      {goldEtf.hasActivity && (
        <>
          <SectionLabel label="Gold ETF" className="px-4" />
          <DetailRow label="LTCG" bold><Num amount={goldEtf.ltcg} signed align /></DetailRow>
          <DetailRow label="STCG" bold><Num amount={goldEtf.stcg} signed align /></DetailRow>
        </>
      )}

      <SectionLabel label={`Dividends · ${dividendRateLabel}`} className="px-4" />
      <DetailRow label="Taxable" bold><Num amount={dividendIncome} signed align /></DetailRow>
      <DetailRow label="Tax"><Num amount={dividendTax} align /></DetailRow>

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

      <div className="px-4" style={{ paddingTop: 12, paddingBottom: 8 }}>
        <button
          onClick={onShare}
          className="flex items-center justify-center gap-2 w-full tap-row"
          style={{ minHeight: 44, color: 'var(--accent)' }}>
          <ShareIcon className="w-[17px] h-[17px]" />
          <span className="text-headline font-semibold">Share</span>
        </button>
      </div>
    </div>
  )
}

// ── Harvesting ───────────────────────────────────────────────────────────────

export function HarvestingBody({
  exemptionUsed, unrealisedLoss,
}: {
  exemptionUsed:  number
  unrealisedLoss: number | null
}) {
  const remaining = LTCG_EXEMPTION - exemptionUsed
  const barPct    = Math.min(100, Math.max(0, (exemptionUsed / LTCG_EXEMPTION) * 100))

  return (
    <div>
      <SectionLabel label="Equity LTCG Exemption" className="px-4" />
      <DetailRow label="Annual limit" muted><span>1.25<span className="num-u"> L</span></span></DetailRow>
      <DetailRow label="Used"><Num amount={exemptionUsed} align /></DetailRow>
      <DetailRow label="Remaining" bold><Num amount={remaining} align /></DetailRow>
      <div className="px-4 pb-3 pt-1">
        <ProgressBar percent={barPct} />
      </div>

      <SectionLabel label="Unrealised Losses" className="px-4" />
      <DetailRow label="Harvestable now" bold>
        {unrealisedLoss !== null && unrealisedLoss < 0
          ? <Num amount={unrealisedLoss} signed align />
          : <span style={{ color: 'var(--text-faint)' }}>None</span>
        }
      </DetailRow>
    </div>
  )
}
