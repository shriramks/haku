'use client'
import { useState } from 'react'
import type { FiscalYear } from '@/lib/types'
import BottomSheet from '@/components/BottomSheet'
import { ChevronRightIcon } from '@/components/icons'
import { generateCSV, generatePDF } from './tax-export'
import type { SellRow } from './tax-export'

function TableIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M3 9h18M3 15h18M9 9v10M15 9v10" />
    </svg>
  )
}

function DocumentIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v6h6M9 13h6M9 17h4" />
    </svg>
  )
}

function ExportSheet({
  onClose, onCSV, onPDF, exporting,
}: {
  onClose:   () => void
  onCSV:     () => void
  onPDF:     () => void
  exporting: 'pdf' | null
}) {
  return (
    <BottomSheet onClose={onClose}>
      <div className="px-5 pt-1 pb-2">
        <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>Export</p>
      </div>
      <div style={{ height: 1, background: 'var(--border-faint)' }} />

      <button
        onClick={onCSV}
        disabled={exporting !== null}
        className="flex items-center w-full px-5 tap-row"
        style={{ minHeight: 62 }}>
        <div className="flex items-center justify-center rounded-xl mr-4 flex-shrink-0"
             style={{ width: 40, height: 40, background: 'color-mix(in srgb, var(--c-positive) 15%, transparent)' }}>
          <TableIcon style={{ width: 20, height: 20, color: 'var(--c-positive)' }} />
        </div>
        <div className="flex flex-col gap-0.5 items-start flex-1 min-w-0">
          <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>CSV Spreadsheet</span>
          <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>Lot-level gains, all asset types</span>
        </div>
        <ChevronRightIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
      </button>

      <div style={{ height: 1, background: 'var(--border-faint)', marginLeft: 69 }} />

      <button
        onClick={onPDF}
        disabled={exporting !== null}
        className="flex items-center w-full px-5 tap-row"
        style={{ minHeight: 62 }}>
        <div className="flex items-center justify-center rounded-xl mr-4 flex-shrink-0"
             style={{ width: 40, height: 40, background: 'color-mix(in srgb, var(--c-negative) 12%, transparent)' }}>
          <DocumentIcon style={{ width: 20, height: 20, color: 'var(--c-negative)' }} />
        </div>
        <div className="flex flex-col gap-0.5 items-start flex-1 min-w-0">
          <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>
            {exporting === 'pdf' ? 'Generating…' : 'PDF Statement'}
          </span>
          <span className="text-footnote" style={{ color: 'var(--text-muted)' }}>CAMS-style capital gains statement</span>
        </div>
        <ChevronRightIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
      </button>
    </BottomSheet>
  )
}

export function ExportBody({ detailRows, selectedFY }: { detailRows: SellRow[]; selectedFY: FiscalYear | null }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [exporting, setExporting]  = useState<'pdf' | null>(null)
  const fyLabel = selectedFY?.label ?? 'FY'

  function handleCSV() {
    generateCSV(detailRows, fyLabel)
    setSheetOpen(false)
  }

  async function handlePDF() {
    setExporting('pdf')
    try {
      await generatePDF(detailRows, fyLabel)
    } finally {
      setExporting(null)
      setSheetOpen(false)
    }
  }

  return (
    <div className="px-4 pt-3 pb-4">
      <p className="text-body pb-4" style={{ color: 'var(--text-muted)' }}>
        Download your capital gains statement — lot-level detail for filing or sharing with your CA.
      </p>
      <button
        onClick={() => setSheetOpen(true)}
        className="w-full rounded-full text-body font-semibold"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', minHeight: 50 }}>
        Export
      </button>
      {sheetOpen && (
        <ExportSheet
          onClose={() => setSheetOpen(false)}
          onCSV={handleCSV}
          onPDF={handlePDF}
          exporting={exporting}
        />
      )}
    </div>
  )
}
