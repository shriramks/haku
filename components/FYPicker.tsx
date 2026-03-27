'use client'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { FiscalYear } from '@/lib/types'

interface Props {
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
  onSelect: (fy: FiscalYear) => void
  onNew?: () => void
}

export default function FYPicker({ fiscalYears, selectedFY, onSelect, onNew }: Props) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (fiscalYears.length <= 1) return null

  const sheet = open && mounted && createPortal(
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]" onClick={() => setOpen(false)} />
      <div className="fixed bottom-0 left-0 right-0 z-[200] rounded-t-[28px]"
           style={{
             background: 'var(--bg-secondary)',
             paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 16px)',
           }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b"
             style={{ borderColor: 'var(--border)' }}>
          <p className="font-semibold text-headline">Fiscal Year</p>
          <button onClick={() => setOpen(false)} className="text-headline text-accent">Done</button>
        </div>
        <div className="py-1">
          {fiscalYears.map(fy => {

            const active = fy.id === selectedFY?.id
            const start = new Date(fy.start_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
            const end   = new Date(fy.end_date).toLocaleDateString('en-IN',   { month: 'short', year: '2-digit' })
            return (
              <button key={fy.id}
                onClick={() => {
                  localStorage.setItem('haku_fy', fy.label)
                  window.dispatchEvent(new Event('haku_fy_change'))
                  onSelect(fy)
                  setOpen(false)
                }}
                className="w-full flex items-center justify-between px-5 py-3.5 tap-row">
                <div className="text-left">
                  <p className="text-headline font-medium" style={{ color: 'var(--text-primary)' }}>{fy.label}</p>
                  <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>{start} – {end}</p>
                </div>
                {active && (
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                       stroke="#0A84FF" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
          {onNew && (
            <button
              onClick={() => { onNew(); setOpen(false) }}
              className="w-full flex items-center justify-between px-5 py-3.5 tap-row border-t"
              style={{ borderColor: 'var(--border)' }}>
              <p className="text-headline font-medium text-accent">New fiscal year</p>
              <svg className="w-4 h-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="#0A84FF" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </>,
    document.body
  )

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-body font-medium"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
        {selectedFY?.label ?? '—'}
        <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {sheet}
    </>
  )
}
