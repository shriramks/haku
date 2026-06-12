'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINRFine } from '@/lib/formatter'
import { Num } from '@/components/Num'
import { parseCsv, type ParsedRow } from '@/lib/csv-parser'
import { fyIdForDate } from '@/lib/fy-utils'
import BottomNav from '@/components/BottomNav'

export default function ImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows]             = useState<ParsedRow[]>([])
  const [fileName, setFileName]     = useState('')
  const [redeploy, setRedeploy]     = useState(true)
  const [importing, setImporting]   = useState(false)
  const [importedCount, setImportedCount] = useState<number | null>(null)
  const [importError, setImportError]     = useState<string | null>(null)

  const validRows   = rows.filter(r => !r.error)
  const invalidRows = rows.filter(r =>  r.error)
  const sellRows    = validRows.filter(r => r.trade_type === 'sell')
  const sellTotal   = sellRows.reduce((s, r) => s + r.amount, 0)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setImportedCount(null)
    setImportError(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      setRows(parseCsv(text))
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (!validRows.length) return
    setImporting(true)
    setImportError(null)

    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Build fy_id map keyed by date to avoid N round-trips for same FY
    const fyCache = new Map<string, string | null>()
    async function getFyId(date: string) {
      if (!fyCache.has(date)) fyCache.set(date, await fyIdForDate(sb, date))
      return fyCache.get(date)!
    }

    // Pre-fetch unique FY ids
    const uniqueDates = [...new Set(validRows.map(r => r.trade_date))]
    await Promise.all(uniqueDates.map(getFyId))

    // Build inserts — omit `amount` (GENERATED ALWAYS column)
    const inserts = validRows.map(r => ({
      user_id:    user.id,
      symbol:     r.symbol,
      exchange:   r.exchange,
      trade_date: r.trade_date,
      trade_type: r.trade_type,
      quantity:   r.quantity,
      price:      r.price,
      fy_id:      fyCache.get(r.trade_date) ?? null,
    }))

    // Batch insert in chunks of 500
    const CHUNK = 500
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const { error } = await sb.from('transactions').insert(inserts.slice(i, i + CHUNK))
      if (error) { setImportError(error.message); setImporting(false); return }
    }

    // Redeploy sell proceeds per FY
    if (redeploy && sellRows.length > 0) {
      // Group sell amounts by fy_id
      const sellByFy = new Map<string, number>()
      for (const r of sellRows) {
        const fyId = fyCache.get(r.trade_date)
        if (!fyId) continue
        sellByFy.set(fyId, (sellByFy.get(fyId) ?? 0) + r.amount)
      }
      for (const [fyId, totalSell] of sellByFy) {
        const { data: fy } = await sb.from('fiscal_years')
          .select('unallocated_carryover_inr').eq('id', fyId).single()
        const current = fy?.unallocated_carryover_inr ?? 0
        await sb.from('fiscal_years')
          .update({ unallocated_carryover_inr: current + totalSell })
          .eq('id', fyId)
      }
    }

    setImporting(false)
    setImportedCount(validRows.length)
    setRows([])
    setFileName('')
  }

  return (
    <>
      <div className="min-h-screen pt-[env(safe-area-inset-top,0px)]"
           style={{ background: 'var(--bg-primary)' }}>

        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          <h1 className="text-title-2 font-bold">Import from Zerodha</h1>
          <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Upload your Zerodha trade book CSV
          </p>
        </div>

        <div className="px-4 pt-4 pb-28 space-y-4">

          {/* File picker */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-4 rounded-2xl font-medium text-body border-2 border-dashed"
              style={{ borderColor: 'var(--border)', color: 'var(--text-2)', background: 'var(--bg-secondary)' }}>
              {fileName ? `📄 ${fileName}` : '+ Choose CSV file'}
            </button>
          </div>

          {/* Parsed summary */}
          {rows.length > 0 && (
            <div className="rounded-2xl p-4 space-y-1"
                 style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-faint)' }}>
              <p className="text-body font-semibold">{rows.length} rows parsed</p>
              <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>
                {validRows.length} valid &nbsp;·&nbsp; {invalidRows.length} with errors
              </p>
              {validRows.filter(r => r.trade_type === 'buy').length > 0 && (
                <p className="text-subheadline text-positive">
                  {validRows.filter(r => r.trade_type === 'buy').length} buys
                </p>
              )}
              {sellRows.length > 0 && (
                <p className="text-subheadline text-warning">
                  {sellRows.length} sells · {formatINRFine(sellTotal)} total proceeds
                </p>
              )}
            </div>
          )}

          {/* Redeploy toggle — shown when there are valid sell rows */}
          {validRows.length > 0 && sellRows.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl"
                 style={{ background: 'rgba(255,149,0,0.06)', border: '1px solid rgba(255,149,0,0.18)', opacity: redeploy ? 1 : 0.6 }}>
              <div className="flex-1 mr-3">
                <p className="text-body font-medium">Redeploy sell proceeds</p>
                <p className="text-subheadline mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {redeploy
                    ? `Adds ${formatINRFine(sellTotal)} to respective FY budgets`
                    : "Proceeds stay within each stock's allocation"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRedeploy(r => !r)}
                className="relative flex-shrink-0"
                style={{ width: 51, height: 31 }}>
                <div className="absolute inset-0 rounded-full transition-colors duration-200"
                     style={{ background: redeploy ? '#34C759' : '#ccc' }} />
                <div className="absolute top-0.5 rounded-full bg-white shadow transition-transform duration-200"
                     style={{ width: 27, height: 27, left: 2, transform: redeploy ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </div>
          )}

          {/* Error rows */}
          {invalidRows.length > 0 && (
            <div className="rounded-2xl overflow-hidden"
                 style={{ border: '1px solid rgba(255,59,48,0.2)' }}>
              <div className="px-4 py-2.5" style={{ background: 'rgba(255,59,48,0.06)' }}>
                <p className="text-subheadline font-semibold text-negative">
                  {invalidRows.length} row{invalidRows.length > 1 ? 's' : ''} skipped (will not be imported)
                </p>
              </div>
              <div className="divide-y divide-[color:var(--divider)]">
                {invalidRows.slice(0, 10).map((r, i) => (
                  <div key={i} className="px-4 py-2" style={{ background: 'var(--bg-secondary)' }}>
                    <p className="text-subheadline font-medium">{r.symbol || '(empty)'}</p>
                    <p className="text-subheadline text-negative">{r.error}</p>
                  </div>
                ))}
                {invalidRows.length > 10 && (
                  <div className="px-4 py-2" style={{ background: 'var(--bg-secondary)' }}>
                    <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>
                      …and {invalidRows.length - 10} more
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preview table */}
          {validRows.length > 0 && (
            <div className="rounded-2xl overflow-hidden"
                 style={{ border: '1px solid var(--border-faint)' }}>
              <div className="px-4 py-2.5" style={{ background: 'var(--bg-secondary)' }}>
                <p className="text-subheadline font-semibold" style={{ color: 'var(--text-muted)' }}>
                  PREVIEW ({validRows.length} rows)
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-subheadline" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                      {['Symbol', 'Date', 'Type', 'Qty', 'Price', 'Amount'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.slice(0, 20).map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border-faint)', background: 'var(--bg-secondary)' }}>
                        <td className="px-3 py-2 font-semibold">{r.symbol}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-2)' }}>{r.trade_date}</td>
                        <td className={`px-3 py-2 font-medium ${r.trade_type === 'buy' ? 'text-positive' : 'text-negative'}`}>
                          {r.trade_type}
                        </td>
                        <td className="px-3 py-2 tabnum" style={{ color: 'var(--text-2)' }}>{r.quantity}</td>
                        <td className="px-3 py-2 tabnum" style={{ color: 'var(--text-2)' }}>{r.price}</td>
                        <td className="px-3 py-2 tabnum"><Num amount={r.amount} /></td>
                      </tr>
                    ))}
                    {validRows.length > 20 && (
                      <tr style={{ borderTop: '1px solid var(--border-faint)', background: 'var(--bg-secondary)' }}>
                        <td colSpan={6} className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                          …and {validRows.length - 20} more rows
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {importError && (
            <p className="text-negative text-subheadline text-center px-4">{importError}</p>
          )}

          {importedCount !== null && (
            <div className="rounded-2xl px-4 py-3 text-center"
                 style={{ background: 'rgba(52,199,89,0.1)', border: '1px solid rgba(52,199,89,0.25)' }}>
              <p className="font-semibold text-positive">
                ✓ {importedCount} transactions imported
              </p>
            </div>
          )}

          {/* Import button */}
          {validRows.length > 0 && (
            <button
              onClick={handleImport}
              disabled={importing}
              className="w-full py-4 rounded-2xl font-bold text-headline text-white transition-all active:scale-[0.98] disabled:opacity-40 bg-accent">
              {importing ? 'Importing…' : `Import ${validRows.length} transaction${validRows.length !== 1 ? 's' : ''}`}
            </button>
          )}

          {/* Help text */}
          <div className="rounded-2xl p-4 space-y-1.5"
               style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-faint)' }}>
            <p className="text-subheadline font-semibold" style={{ color: 'var(--text-2)' }}>How to export from Zerodha</p>
            <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>
              Console → Reports → Trade book → Select date range → Download CSV
            </p>
            <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>
              Required columns: symbol, trade_date, trade_type, quantity, price, exchange
            </p>
          </div>

        </div>
      </div>
      <BottomNav />
    </>
  )
}
