'use client'
import type { BuyBandSnapshot } from '@/lib/types'
import { signalLabel, signalColor } from '@/lib/snowball'
import type { SnowballResult, Zone, CondResult } from '@/lib/snowball'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import { CompRow, SectionLabel } from '@/components/detail-rows'


function zoneCssColor(zone: Zone): string {
  if (zone === 'DEEP_VALUE') return 'var(--c-deep)'
  if (zone === 'BUY') return 'var(--c-positive)'
  if (zone === 'TRIM') return 'var(--c-negative)'
  return 'var(--c-warning)'
}

function zoneDisplayLabel(zone: Zone): string {
  if (zone === 'DEEP_VALUE') return 'Deep Value'
  if (zone === 'BUY') return 'Buy'
  if (zone === 'MID') return 'Mid'
  if (zone === 'WATCH') return 'Watch'
  return 'Trim'
}

function zoneDescription(zone: Zone): string {
  if (zone === 'DEEP_VALUE') return 'Below buy band'
  if (zone === 'BUY') return 'Within buy band'
  if (zone === 'MID') return 'Within mid band'
  if (zone === 'WATCH') return 'Above buy band'
  return 'Above trim price'
}

function condCssColor(cond: CondResult): string {
  if (cond === 'PASS') return 'var(--c-positive)'
  if (cond === 'FAIL') return 'var(--c-negative)'
  return 'var(--text-faint)'
}

function condDisplayLabel(cond: CondResult): string {
  if (cond === 'PASS') return 'Pass'
  if (cond === 'FAIL') return 'Fail'
  return '—'
}

function entryStrengthColor(label: string): string {
  if (label === 'STRONG') return 'var(--c-positive)'
  if (label === 'MODERATE') return 'var(--c-warning)'
  return 'var(--c-negative)'
}

function formatPct(n: number | null): string {
  if (n === null) return '—'
  return `${(n * 100).toFixed(1)}%`
}

export default function SnowballSheet({ symbol, snowball, snapshot, priorSnapshot, onClose }: {
  symbol: string
  snowball: SnowballResult | null
  snapshot: BuyBandSnapshot | null
  priorSnapshot: BuyBandSnapshot | null
  onClose: () => void
}) {
  return (
    <BottomSheet onClose={onClose} className="overflow-y-auto max-h-[90vh]">
      <SheetHeader
        title={
          <div className="flex flex-col items-center" style={{ gap: 1 }}>
            <span className="text-footnote font-semibold" style={{ color: 'var(--text-faint)', letterSpacing: '0.06em' }}>{symbol}</span>
            <span className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>Snowball Check</span>
          </div>
        }
        left={null}
        right={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Done</button>}
      />

      <div className="px-5 pt-4 pb-3">
        <p className="text-subheadline" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Combines CMP with three fundamental checks — earnings growth, margin trend, and growth momentum — to tell whether to add aggressively or wait.
        </p>
      </div>

      <div className="px-5 pb-8">
        {!snowball ? (
          <p className="text-subheadline py-5" style={{ color: 'var(--text-muted)' }}>
            Set up financials and bands to compute Snowball.
          </p>
        ) : (
          <>
            {/* Signal badge */}
            <div className="flex justify-center" style={{ paddingTop: 20, paddingBottom: 20 }}>
              <span
                className="tabnum text-headline font-semibold"
                style={{
                  color: signalColor(snowball.signal),
                  background: `color-mix(in srgb, ${signalColor(snowball.signal)} 12%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${signalColor(snowball.signal)} 25%, transparent)`,
                  borderRadius: 999,
                  padding: '8px 20px',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}>
                {signalLabel(snowball.signal)}
              </span>
            </div>

            {/* Zone */}
            <SectionLabel label="Zone" />
            <CompRow
              k={zoneDisplayLabel(snowball.zone)}
              v={zoneDescription(snowball.zone)}
              valueColor={zoneCssColor(snowball.zone)}
            />

            {/* Conditions */}
            <SectionLabel label="Conditions" />
            <CompRow
              k="Growth > 12% CAGR"
              v={condDisplayLabel(snowball.cond1)}
              valueColor={condCssColor(snowball.cond1)}
            />
            <CompRow
              k="Margin improving"
              v={condDisplayLabel(snowball.cond2)}
              valueColor={condCssColor(snowball.cond2)}
            />
            <CompRow
              k="Growth holding"
              v={condDisplayLabel(snowball.cond3)}
              valueColor={condCssColor(snowball.cond3)}
            />

            {/* Entry Strength — only BUY / DEEP_VALUE */}
            {snowball.entryStrength !== null && snowball.entryStrengthLabel !== null && (
              <>
                <SectionLabel label="Entry Strength" />
                <CompRow
                  k={`${snowball.entryStrength}/3 conditions met`}
                  v={snowball.entryStrengthLabel}
                  valueColor={entryStrengthColor(snowball.entryStrengthLabel)}
                />
              </>
            )}

            {/* Fundamentals — current vs prior */}
            <SectionLabel label="Fundamentals" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0 20px', paddingTop: 4 }}>
              {/* Header */}
              <span />
              <span className="text-caption1 font-semibold tabnum" style={{ color: 'var(--text-faint)', letterSpacing: '0.05em', textAlign: 'right' }}>CURRENT</span>
              <span className="text-caption1 font-semibold tabnum" style={{ color: 'var(--text-faint)', letterSpacing: '0.05em', textAlign: 'right' }}>PRIOR</span>

              {/* Growth */}
              <span className="text-subheadline" style={{ color: 'var(--text-primary)', paddingTop: 12, paddingBottom: 2 }}>Growth</span>
              <span className="text-subheadline tabnum" style={{ color: 'var(--text-primary)', textAlign: 'right', paddingTop: 12, paddingBottom: 2 }}>{formatPct(snapshot?.g_computed ?? null)}</span>
              <span className="text-subheadline tabnum" style={{ color: 'var(--text-muted)', textAlign: 'right', paddingTop: 12, paddingBottom: 2 }}>{formatPct(priorSnapshot?.g_computed ?? null)}</span>

              {/* Op Margin */}
              <span className="text-subheadline" style={{ color: 'var(--text-primary)', paddingBottom: 12 }}>Op Margin</span>
              <span className="text-subheadline tabnum" style={{ color: 'var(--text-primary)', textAlign: 'right', paddingBottom: 12 }}>{formatPct(snapshot?.op_margin ?? null)}</span>
              <span className="text-subheadline tabnum" style={{ color: 'var(--text-muted)', textAlign: 'right', paddingBottom: 12 }}>{formatPct(priorSnapshot?.op_margin ?? null)}</span>

              {/* Snapshot labels */}
              <span className="text-footnote" style={{ color: 'var(--text-faint)' }}>Snapshot</span>
              <span className="text-footnote tabnum" style={{ color: 'var(--text-faint)', textAlign: 'right' }}>{snapshot?.label ?? '—'}</span>
              <span className="text-footnote tabnum" style={{ color: 'var(--text-faint)', textAlign: 'right' }}>{priorSnapshot?.label ?? '—'}</span>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  )
}
