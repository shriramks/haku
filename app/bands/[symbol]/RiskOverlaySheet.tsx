'use client'
import { useState } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { revalidateBuyBands } from '@/app/actions'
import type { BuyBand } from '@/lib/types'
import BottomSheet from '@/components/BottomSheet'
import SheetHeader from '@/components/SheetHeader'
import { LabeledInput } from '@/components/LabeledInput'

export default function RiskOverlaySheet({ band, onClose, onSaved }: {
  band: BuyBand | null
  onClose: () => void
  onSaved: (b: BuyBand) => void
}) {
  const [value, setValue] = useState(band?.risk_multiplier != null ? String(band.risk_multiplier) : '')
  const [saving, setSaving] = useState(false)

  const parsed = parseFloat(value.trim())
  const isValid = Number.isFinite(parsed) && parsed > 0 && parsed < 1
  const showWarning = value.trim() !== '' && !isValid

  async function save() {
    if (!band) return
    setSaving(true)
    const multiplier = isValid ? parsed : null
    const { data } = await getSupabaseBrowser()
      .from('buy_bands').update({ risk_multiplier: multiplier }).eq('id', band.id).select().single()
    if (data) onSaved(data)
    await revalidateBuyBands()
    setSaving(false)
    onClose()
  }

  async function removeOverlay() {
    if (!band) return
    setSaving(true)
    const { data } = await getSupabaseBrowser()
      .from('buy_bands').update({ risk_multiplier: null }).eq('id', band.id).select().single()
    if (data) onSaved(data)
    await revalidateBuyBands()
    setSaving(false)
    onClose()
  }

  return (
    <BottomSheet onClose={onClose}>
      <SheetHeader
        title="Risk Overlay"
        left={<button onClick={onClose} className="text-accent text-headline" style={{ minHeight: 44 }}>Cancel</button>}
        right={
          <button onClick={save} disabled={saving}
            className="text-accent text-headline font-semibold disabled:opacity-40" style={{ minHeight: 44 }}>
            {saving ? '…' : 'Save'}
          </button>
        }
      />
      <div className="px-5 pt-4 pb-3">
        <p className="text-subheadline" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Risk Overlay adjusts buy bands when a known stock-specific or sector-specific risk may impair earnings durability, valuation multiple, or business model stability.
        </p>
      </div>
      <div className="px-5 pb-4">
        <LabeledInput
          label="Multiplier (0–1 · e.g. 0.85 = 15% discount)"
          value={value}
          onChange={setValue}
          placeholder="e.g. 0.85"
          step="0.01"
          autoFocus
          invalid={showWarning}
          onEnter={save}
        />
        {showWarning && (
          <p className="text-subheadline mt-1.5" style={{ color: 'var(--c-warning)' }}>
            Enter a value between 0 and 1. Leave blank to clear overlay.
          </p>
        )}
      </div>
      {band?.risk_multiplier != null && band.risk_multiplier !== 1 && (
        <div className="px-5">
          <button
            onClick={removeOverlay}
            disabled={saving}
            className="w-full py-3 rounded-xl text-body font-medium text-negative disabled:opacity-40"
            style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.18)' }}>
            Remove Overlay
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
