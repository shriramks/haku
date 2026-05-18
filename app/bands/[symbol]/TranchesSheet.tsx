'use client'
import type { BuyTranche } from '@/lib/types'
import type { Signal } from '@/lib/snowball'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import TrancheSection from '@/components/TrancheSection'

function signalPillColor(signal: Signal): string {
  if (signal === 'ADD_AGGRESSIVE' || signal === 'ADD_MEASURED') return 'var(--c-positive)'
  if (signal === 'WAIT') return 'var(--c-warning)'
  if (signal === 'BLOCK') return 'var(--c-negative)'
  return 'var(--text-faint)'
}

function signalPillLabel(signal: Signal): string {
  if (signal === 'ADD_AGGRESSIVE') return 'Add Aggressively'
  if (signal === 'ADD_MEASURED') return 'Add Slowly'
  if (signal === 'WAIT') return 'Wait'
  if (signal === 'BLOCK') return 'Trim'
  return '—'
}

export default function TranchesSheet({ symbol, tranches, remaining, budget, hasBands, cmp, generating, genError,
  signal, recentBuys, onAdd, onDelete, onUpdate, onGenerate, onClear, onClose }: {
  symbol: string
  tranches: BuyTranche[]
  remaining: number
  budget: number
  hasBands: boolean
  cmp: number | null
  generating: boolean
  genError: string
  signal: Signal | null
  recentBuys: { price: number; date: string }[]
  onAdd: (symbol: string, qty: number, price: number) => Promise<void>
  onDelete: (id: string) => void
  onUpdate: (id: string, qty: number, price: number) => Promise<void>
  onGenerate: () => void
  onClear: () => Promise<void>
  onClose: () => void
}) {
  const showPill = signal != null && signal !== 'INSUFFICIENT_DATA'
  const pillColor = showPill ? signalPillColor(signal!) : null

  return (
    <BottomSheet onClose={onClose} className="overflow-y-auto max-h-[85vh]">
      <SheetHeader
        title={
          showPill ? (
            <div className="flex items-center gap-2">
              <span>Buy Levels</span>
              <span style={{
                color: pillColor!,
                background: `color-mix(in srgb, ${pillColor} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${pillColor} 25%, transparent)`,
                borderRadius: 999,
                padding: '2px 9px',
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1.6,
              }}>
                {signalPillLabel(signal!)}
              </span>
            </div>
          ) : 'Buy Levels'
        }
        left={null}
        right={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Done</button>}
      />
      {genError && (
        <p className="px-5 pt-3 text-subheadline text-negative">{genError}</p>
      )}
      <TrancheSection
        symbol={symbol}
        tranches={tranches}
        remaining={remaining}
        budget={budget}
        hasBands={hasBands}
        cmp={cmp}
        recentBuys={recentBuys}
        onAdd={onAdd}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onGenerate={onGenerate}
        onClear={onClear}
        generating={generating}
        hideHeader
      />
    </BottomSheet>
  )
}
