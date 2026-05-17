'use client'
import type { BuyTranche } from '@/lib/types'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import TrancheSection from '@/components/TrancheSection'

export default function TranchesSheet({ symbol, tranches, remaining, budget, hasBands, cmp, generating, genError,
  onAdd, onDelete, onUpdate, onGenerate, onClear, onClose }: {
  symbol: string
  tranches: BuyTranche[]
  remaining: number
  budget: number
  hasBands: boolean
  cmp: number | null
  generating: boolean
  genError: string
  onAdd: (symbol: string, qty: number, price: number) => Promise<void>
  onDelete: (id: string) => void
  onUpdate: (id: string, qty: number, price: number) => Promise<void>
  onGenerate: () => void
  onClear: () => Promise<void>
  onClose: () => void
}) {
  return (
    <BottomSheet onClose={onClose} className="overflow-y-auto max-h-[85vh]">
      <SheetHeader
        title="Buy Levels"
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
