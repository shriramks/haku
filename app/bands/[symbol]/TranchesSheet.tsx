'use client'
import type { BuyTranche } from '@/lib/types'
import { signalLabel, signalColor, signalStrategyWord } from '@/lib/snowball'
import type { Signal, Zone } from '@/lib/snowball'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import TrancheSection from '@/components/TrancheSection'

function zoneLabel(zone: Zone): string {
  if (zone === 'DEEP_VALUE') return 'Deep Value'
  if (zone === 'BUY') return 'Buy Zone'
  return zone
}

export default function TranchesSheet({ symbol, tranches, remaining, budget, hasBands, cmp, generating, genError,
  signal, zone, onAdd, onDelete, onUpdate, onGenerate, onClear, onClose }: {
  symbol: string
  tranches: BuyTranche[]
  remaining: number
  budget: number
  hasBands: boolean
  cmp: number | null
  generating: boolean
  genError: string
  signal: Signal | null
  zone: Zone | null
  onAdd: (symbol: string, qty: number, price: number) => Promise<void>
  onDelete: (id: string) => void
  onUpdate: (id: string, qty: number, price: number) => Promise<void>
  onGenerate: () => void
  onClear: () => Promise<void>
  onClose: () => void
}) {
  const showPill = signal != null && signal !== 'INSUFFICIENT_DATA'
  const pillColor = showPill ? signalColor(signal!) : null
  const strategyWord = signal ? signalStrategyWord(signal) : null
  const showDescriptor = tranches.length > 0 && strategyWord != null
  const zoneStr = zone && (zone === 'DEEP_VALUE' || zone === 'BUY') ? zoneLabel(zone) : null

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
                {signalLabel(signal!)}
              </span>
            </div>
          ) : 'Buy Levels'
        }
        left={null}
        right={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Done</button>}
      />
      {showDescriptor && (
        <p className="px-5 pt-1 pb-0 text-subheadline text-secondary tabnum">
          {tranches.length} tranches · {strategyWord}{zoneStr ? ` · ${zoneStr}` : ''}
        </p>
      )}
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
