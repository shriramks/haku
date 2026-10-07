'use client'

import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import { Num } from '@/components/Num'
import type { RegionExposure } from '@/lib/exposure'

// Opened by tapping the allocation pie on Portfolio: the same money as the pie, cut by region.
export default function RegionSheet({ region, onClose }: { region: RegionExposure; onClose: () => void }) {
  const { indiaValue, usValue, indiaPct, usPct } = region
  const hasUs = usValue > 0

  return (
    <BottomSheet onClose={onClose}>
      <SheetHeader
        title="Exposure by region"
        left={null}
        right={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Done</button>}
      />

      <div className="px-5 pt-4 pb-8">
        <div className="flex overflow-hidden rounded-full" style={{ height: 12, gap: 2, background: 'var(--bg-tertiary)' }}>
          {indiaPct > 0 && <div style={{ width: `${indiaPct}%`, background: 'var(--c-region-in)' }} />}
          {usPct > 0 && <div style={{ width: `${usPct}%`, background: 'var(--c-region-us)' }} />}
        </div>

        <div className="flex justify-between" style={{ paddingTop: 16 }}>
          <LegendItem color="var(--c-region-in)" label="India" pct={indiaPct} amount={indiaValue} />
          <LegendItem color="var(--c-region-us)" label="US" pct={usPct} amount={usValue} right />
        </div>

        <p className="text-subheadline" style={{ color: 'var(--text-muted)', lineHeight: 1.5, paddingTop: 24 }}>
          {hasUs ? '' : 'No US funds found. '}
          A mutual fund counts as US when its name has US, S&amp;P or Nasdaq. Stocks, gold, PPF and EPF count as India.
        </p>
      </div>
    </BottomSheet>
  )
}

function LegendItem({ color, label, pct, amount, right }: {
  color: string; label: string; pct: number; amount: number; right?: boolean
}) {
  return (
    <div className={`flex items-center gap-2 ${right ? 'flex-row-reverse text-right' : ''}`}>
      <span className="rounded-full flex-shrink-0" style={{ width: 8, height: 8, background: color }} />
      <div>
        <p>
          <span className="text-headline font-semibold tabnum"><Num pct={pct} /></span>
          <span className="text-body" style={{ marginLeft: 6 }}>{label}</span>
        </p>
        <p className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}><Num amount={amount} /></p>
      </div>
    </div>
  )
}
