'use client'
import { useState } from 'react'
import type { RealisedGain, GainType, UnrealisedPosition } from '@/lib/tax-compute'
import { formatDate } from '@/lib/formatter'
import BottomSheet from '@/components/BottomSheet'
import { Num } from '@/components/Num'
import { ChevronDownIcon } from '@/components/icons'
import { DetailRow, SectionLabel } from '@/components/detail-rows'
import { LTCG_EXEMPTION } from './tax-export'
import type { SellRow } from './tax-export'

export type SectionKey = 'summary' | 'details' | 'harvesting' | 'export'

export interface NearThresholdRow {
  position:   UnrealisedPosition
  daysToLTCG: number
  name:       string
}

// ── Section wrapper ────────────────────────────────────────────────────────────

export function Section({
  title,
  sectionKey,
  expanded,
  onToggle,
  children,
}: {
  title:      string
  sectionKey: SectionKey
  expanded:   Set<SectionKey>
  onToggle:   (k: SectionKey) => void
  children:   React.ReactNode
}) {
  const isOpen = expanded.has(sectionKey)
  return (
    <div className="border-b" style={{ borderColor: 'var(--border-faint)' }}>
      <button
        onClick={() => onToggle(sectionKey)}
        className="flex items-center justify-between w-full px-4 tap-row"
        style={{ minHeight: 48 }}>
        <span className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <ChevronDownIcon
          className="w-4 h-4 transition-transform"
          style={{
            color: 'var(--text-faint)',
            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        />
      </button>
      {isOpen && children}
    </div>
  )
}

// ── Summary section body ───────────────────────────────────────────────────────

export function SummaryBody({
  equityLTCG,
  taxableLTCG,
  ltcgTax,
  equitySTCG,
  stcgTax,
  debtLTCG,
  debtSTCG,
  goldLTCG,
  goldSTCG,
  dividendIncome,
}: {
  equityLTCG:     number
  taxableLTCG:    number
  ltcgTax:        number
  equitySTCG:     number
  stcgTax:        number
  debtLTCG:       number
  debtSTCG:       number
  goldLTCG:       number
  goldSTCG:       number
  dividendIncome: number
}) {
  const hasDebt = debtLTCG !== 0 || debtSTCG !== 0
  const hasGold = goldLTCG !== 0 || goldSTCG !== 0

  return (
    <div className="pb-2">

      <SectionLabel label="Equity LTCG" className="px-4" />
      <DetailRow label="Gains" bold noRupee><Num amount={equityLTCG} signed /></DetailRow>
      <DetailRow label="Exemption" muted noRupee><span>1.25<span className="num-u"> L</span></span></DetailRow>
      <DetailRow label="Taxable Gains" bold noRupee><Num amount={taxableLTCG} signed /></DetailRow>
      <DetailRow label="Tax @ 12.5%" bold noRupee><Num amount={ltcgTax} /></DetailRow>

      <SectionLabel label="Equity STCG" className="px-4" />
      <DetailRow label="Gains" bold noRupee><Num amount={equitySTCG} signed /></DetailRow>
      <DetailRow label="Tax @ 20%" bold noRupee><Num amount={stcgTax} /></DetailRow>

      {hasDebt && (
        <>
          <SectionLabel label="Debt" className="px-4" />
          <DetailRow label="LTCG" bold noRupee><Num amount={debtLTCG} signed /></DetailRow>
          <DetailRow label="STCG" bold noRupee><Num amount={debtSTCG} signed /></DetailRow>
          <div className="px-4 pb-2">
            <p className="text-footnote" style={{ color: 'var(--text-faint)' }}>Debt gains taxed at slab rate — verify with your CA</p>
          </div>
        </>
      )}

      {hasGold && (
        <>
          <SectionLabel label="Gold" className="px-4" />
          <DetailRow label="LTCG" bold noRupee><Num amount={goldLTCG} signed /></DetailRow>
          <DetailRow label="STCG" bold noRupee><Num amount={goldSTCG} signed /></DetailRow>
        </>
      )}

      <SectionLabel label="Dividend Income" className="px-4" />
      <DetailRow label="Received" bold noRupee><Num amount={dividendIncome} signed /></DetailRow>

    </div>
  )
}

// ── Details section body ───────────────────────────────────────────────────────

export function DetailsBody({ rows }: { rows: SellRow[] }) {
  const [selected, setSelected] = useState<SellRow | null>(null)

  if (rows.length === 0) {
    return (
      <div className="px-4 py-3">
        <p className="text-body" style={{ color: 'var(--text-muted)' }}>No realised gains this FY</p>
      </div>
    )
  }

  const stockRows = rows.filter(r => r.assetType === 'stock')
  const mfRows    = rows.filter(r => r.assetType === 'mf')
  const goldRows  = rows.filter(r => r.assetType === 'gold')

  return (
    <div className="pb-2">
      {stockRows.length > 0 && (
        <>
          <SectionLabel label="Stocks" className="px-4" />
          {stockRows.map(row => (
            <GainRow key={`${row.symbol}-${row.sellDate}`} row={row} onTap={() => setSelected(row)} />
          ))}
        </>
      )}
      {mfRows.length > 0 && (
        <>
          <SectionLabel label="Mutual Funds" className="px-4" />
          {mfRows.map(row => (
            <GainRow key={`${row.symbol}-${row.sellDate}`} row={row} onTap={() => setSelected(row)} />
          ))}
        </>
      )}
      {goldRows.length > 0 && (
        <>
          <SectionLabel label="Gold" className="px-4" />
          {goldRows.map(row => (
            <GainRow key={`${row.symbol}-${row.sellDate}`} row={row} onTap={() => setSelected(row)} />
          ))}
        </>
      )}
      {selected && <LotDetailSheet row={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

export function GainBadge({ gainType }: { gainType: GainType | 'mixed' }) {
  const isLTCG = gainType === 'LTCG'
  const isSTCG = gainType === 'STCG'
  const color  = isLTCG ? 'var(--c-positive)' : isSTCG ? 'var(--c-warning)' : 'var(--text-muted)'
  const bg     = isLTCG
    ? 'color-mix(in srgb, var(--c-positive) 12%, transparent)'
    : isSTCG
      ? 'color-mix(in srgb, var(--c-warning) 12%, transparent)'
      : 'var(--bg-tertiary)'
  const label  = isLTCG ? 'LTCG' : isSTCG ? 'STCG' : 'Mixed'
  return (
    <span
      className="text-footnote font-semibold"
      style={{ color, background: bg, padding: '1px 5px', borderRadius: 4, letterSpacing: '0.03em', flexShrink: 0 }}>
      {label}
    </span>
  )
}

export function GainRow({ row, onTap }: { row: SellRow; onTap: () => void }) {
  const daysLabel = row.minDays === row.maxDays
    ? `held ${row.minDays} days`
    : `held ${row.minDays}–${row.maxDays} days`

  return (
    <button
      onClick={onTap}
      className="flex items-center justify-between w-full px-4 tap-row"
      style={{ minHeight: 52 }}>
      <div className="flex flex-col gap-0.5 items-start min-w-0">
        <span className="text-body font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {row.name}
        </span>
        <div className="flex items-center gap-1.5">
          <GainBadge gainType={row.gainType} />
          <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>
            Sold {formatDate(row.sellDate)} · {daysLabel}
          </span>
        </div>
      </div>
      <span className="tabnum text-body ml-3 flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
        <Num amount={row.totalGain} signed />
      </span>
    </button>
  )
}

export function LotDetailSheet({ row, onClose }: { row: SellRow; onClose: () => void }) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="px-4 pt-1 pb-3">
        <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>{row.name}</p>
        <p className="text-footnote mt-0.5" style={{ color: 'var(--text-muted)' }}>Sold {formatDate(row.sellDate)}</p>
      </div>
      <div style={{ height: 1, background: 'var(--border-faint)' }} />
      {row.lots.map((lot, i) => <LotRow key={i} lot={lot} />)}
    </BottomSheet>
  )
}

export function LotRow({ lot }: { lot: RealisedGain }) {
  const qtyStr = Number.isInteger(lot.qty) ? String(lot.qty) : lot.qty.toFixed(3).replace(/\.?0+$/, '')
  return (
    <div className="flex items-center justify-between px-4" style={{ minHeight: 52 }}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-body" style={{ color: 'var(--text-primary)' }}>
            Bought {formatDate(lot.purchaseDate)}
          </span>
          <GainBadge gainType={lot.gainType} />
        </div>
        <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>
          {qtyStr} units · <Num amount={lot.purchaseCost} /> → <Num amount={lot.saleValue} /> · {lot.holdingDays} days
        </span>
      </div>
      <span className="tabnum text-body ml-3 flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
        <Num amount={lot.gain} signed />
      </span>
    </div>
  )
}

// ── Harvesting section body ────────────────────────────────────────────────────

export function HarvestingBody({
  equityLTCG,
  equitySTCG,
  unrealisedLoss,
  nearThreshold,
  pricesLoading,
}: {
  equityLTCG:     number
  equitySTCG:     number
  unrealisedLoss: number | null
  nearThreshold:  NearThresholdRow[]
  pricesLoading:  boolean
}) {
  const equityTotal   = equityLTCG + equitySTCG
  const barPct        = Math.min(100, Math.max(0, (equityTotal / LTCG_EXEMPTION) * 100))
  const overThreshold = equityTotal > LTCG_EXEMPTION
  const barColor      = overThreshold ? 'var(--c-warning)' : 'var(--c-positive)'
  const remaining     = LTCG_EXEMPTION - equityTotal

  return (
    <div className="pb-2">

      <SectionLabel label="LTCG Exemption" className="px-4" />
      <DetailRow label="Realised gains" bold noRupee><Num amount={equityTotal} signed /></DetailRow>
      <div className="px-4 pb-3 pt-1">
        <div className="rounded-full overflow-hidden" style={{ height: 8, background: 'var(--border-faint)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: barColor }} />
        </div>
        <p className="text-footnote mt-1.5" style={{ color: 'var(--text-faint)' }}>
          <Num amount={equityTotal} /> of 1.25 L used
          {overThreshold
            ? <> · <Num amount={-remaining} /> over limit</>
            : <> · <Num amount={remaining} /> remaining</>
          }
        </p>
      </div>

      <SectionLabel label="Equity Gains" className="px-4" />
      <DetailRow label="LTCG" bold noRupee><Num amount={equityLTCG} signed /></DetailRow>
      <DetailRow label="STCG" bold noRupee><Num amount={equitySTCG} signed /></DetailRow>

      <SectionLabel label="Harvestable Losses" className="px-4" />
      <DetailRow label="Unrealised losses" bold noRupee>
        {pricesLoading
          ? <span style={{ color: 'var(--text-faint)' }}>—</span>
          : unrealisedLoss !== null && unrealisedLoss < 0
            ? <Num amount={unrealisedLoss} signed />
            : <span style={{ color: 'var(--text-faint)' }}>None</span>
        }
      </DetailRow>

      <SectionLabel label="Approaching 1-Year Threshold" className="px-4" />
      <p className="px-4 pb-2 text-footnote" style={{ color: 'var(--text-muted)' }}>
        Hold until they cross — selling now incurs STCG instead of LTCG.
      </p>
      {nearThreshold.length === 0 ? (
        <div className="px-4 pb-2">
          <p className="text-body" style={{ color: 'var(--text-faint)' }}>None approaching threshold</p>
        </div>
      ) : (
        nearThreshold.map((row, i) => (
          <div key={i} className="flex items-center justify-between px-4" style={{ minHeight: 48 }}>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-body font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {row.name}
              </span>
              <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>
                {row.position.holdingDays} days held · bought {formatDate(row.position.purchaseDate)}
              </span>
            </div>
            <span className="tabnum text-body ml-3 flex-shrink-0 font-semibold"
                  style={{ color: row.daysToLTCG <= 7 ? 'var(--c-warning)' : 'var(--text-primary)' }}>
              {row.daysToLTCG}d
            </span>
          </div>
        ))
      )}

    </div>
  )
}
