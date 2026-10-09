'use client'

import Link from 'next/link'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import { Num } from '@/components/Num'
import type { RegionExposure } from '@/lib/exposure'

// Opened by tapping the allocation pie on Portfolio: the same money as the pie, cut by region.
export default function RegionSheet({ region, onClose }: { region: RegionExposure; onClose: () => void }) {
  const { indiaValue, usValue, indiaPct, usPct, equity, usFunds } = region

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

        {equity.some(g => g.value > 0) && (
          <div style={{ paddingTop: 32 }}>
            <p className="label-section">Equity by region</p>
            {equity.filter(g => g.value > 0).map(g => (
              <div key={g.key} className="flex items-baseline justify-between" style={{ paddingTop: 16 }}>
                <div>
                  <p className="text-headline">{g.label}</p>
                  <p className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}><Num pct={g.pctOfEquity} /> of equity</p>
                </div>
                <div className="text-right">
                  <p className="text-headline tabnum"><Num amount={g.value} /></p>
                  <p className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}>
                    XIRR {g.xirr === null ? '—' : <Num pct={g.xirr * 100} signed />}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {usFunds.length > 0 && (
          <div style={{ paddingTop: 32 }}>
            <p className="label-section">US funds</p>
            {usFunds.map(f => (
              <Link key={f.fundId} href={`/portfolio/mf/${f.fundId}`}
                className="flex items-baseline justify-between gap-4" style={{ paddingTop: 16, minHeight: 44 }}>
                <div className="min-w-0">
                  <p className="text-headline">{f.name}</p>
                  <p className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}><Num pct={f.pctOfTotal} /> of portfolio</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-headline tabnum"><Num amount={f.value} /></p>
                  <p className="text-subheadline tabnum" style={{ color: 'var(--text-2)' }}>
                    XIRR {f.xirr === null ? '—' : <Num pct={f.xirr * 100} signed />}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
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
