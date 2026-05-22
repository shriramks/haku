import type { AssetType, RealisedGain, GainType } from '@/lib/tax-compute'

export const LTCG_EXEMPTION = 125_000  // 1.25 L — Budget 2024

export interface SellRow {
  assetType: AssetType
  symbol:    string
  name:      string
  sellDate:  string
  lots:      RealisedGain[]
  totalGain: number
  gainType:  GainType | 'mixed'
  minDays:   number
  maxDays:   number
}

export function generateCSV(rows: SellRow[], fyLabel: string): void {
  const esc = (v: string | number) => {
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }

  const lines: string[] = [
    `Capital Gains Statement - ${fyLabel}`,
    `Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    '',
  ]

  const colHeaders = ['SNo', 'Symbol / Fund', 'Units', 'Purchase Date', 'Purchase Value (INR)', 'Sale Date', 'Sale Proceeds (INR)', 'STCG (INR)', 'LTCG (INR)']
  const assetGroups: [AssetType, string][] = [['stock', 'STOCKS'], ['mf', 'MUTUAL FUNDS'], ['gold', 'GOLD']]

  let grandSTCG = 0, grandLTCG = 0

  for (const [assetType, groupLabel] of assetGroups) {
    const groupRows = rows.filter(r => r.assetType === assetType)
    if (groupRows.length === 0) continue

    lines.push(groupLabel)
    lines.push(colHeaders.map(esc).join(','))

    let sno = 1, groupSTCG = 0, groupLTCG = 0

    for (const sellRow of groupRows) {
      for (const lot of sellRow.lots) {
        const stcg = lot.gainType === 'STCG' ? lot.gain : 0
        const ltcg = lot.gainType === 'LTCG' ? lot.gain : 0
        groupSTCG += stcg
        groupLTCG += ltcg
        const qty = Number.isInteger(lot.qty) ? String(lot.qty) : lot.qty.toFixed(3).replace(/\.?0+$/, '')
        lines.push([
          sno++, esc(sellRow.name), qty,
          lot.purchaseDate, lot.purchaseCost.toFixed(2),
          lot.sellDate, lot.saleValue.toFixed(2),
          stcg.toFixed(2), ltcg.toFixed(2),
        ].join(','))
      }
    }

    grandSTCG += groupSTCG
    grandLTCG += groupLTCG
    lines.push(['', 'Total', '', '', '', '', '', groupSTCG.toFixed(2), groupLTCG.toFixed(2)].join(','))
    lines.push('')
  }

  lines.push(['GRAND TOTAL', '', '', '', '', '', '', grandSTCG.toFixed(2), grandLTCG.toFixed(2)].join(','))

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `capital-gains-${fyLabel}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function generatePDF(rows: SellRow[], fyLabel: string): Promise<void> {
  const { jsPDF }     = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')

  const doc       = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin    = 14
  const fmtINR    = (n: number) => n.toFixed(2)
  const fmtQty    = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')

  // Header
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Capital Gains Statement', pageWidth / 2, 20, { align: 'center' })
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(fyLabel, pageWidth / 2, 28, { align: 'center' })
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text(
    `Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    pageWidth / 2, 34, { align: 'center' }
  )
  doc.setTextColor(0)

  let curY = 44
  const colHeaders = ['SNo', 'Units', 'Purchase Date', 'Purchase Value', 'Sale Date', 'Sale Proceeds', 'STCG', 'LTCG']
  const colStyles = {
    0: { cellWidth: 10 },
    1: { cellWidth: 16, halign: 'right' as const },
    2: { cellWidth: 26 },
    3: { cellWidth: 27, halign: 'right' as const },
    4: { cellWidth: 26 },
    5: { cellWidth: 27, halign: 'right' as const },
    6: { cellWidth: 25, halign: 'right' as const },
    7: { cellWidth: 25, halign: 'right' as const },
  }

  const assetGroups: [AssetType, string][] = [['stock', 'Stocks'], ['mf', 'Mutual Funds'], ['gold', 'Gold']]
  let grandSTCG = 0, grandLTCG = 0

  for (const [assetType, groupLabel] of assetGroups) {
    const groupRows = rows.filter(r => r.assetType === assetType)
    if (groupRows.length === 0) continue

    let groupSTCG = 0, groupLTCG = 0

    // Section heading + underline
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(groupLabel, margin, curY)
    curY += 2
    doc.setDrawColor(180)
    doc.line(margin, curY, pageWidth - margin, curY)
    curY += 5

    const seen = new Set<string>()
    const symbolOrder: { symbol: string; name: string }[] = []
    for (const r of groupRows) {
      if (!seen.has(r.symbol)) { seen.add(r.symbol); symbolOrder.push({ symbol: r.symbol, name: r.name }) }
    }

    for (const { symbol, name } of symbolOrder) {
      const symbolRows = groupRows.filter(r => r.symbol === symbol)
      let symSTCG = 0, symLTCG = 0
      let sno = 1

      const tableBody: string[][] = []
      for (const sellRow of symbolRows) {
        for (const lot of sellRow.lots) {
          const stcg = lot.gainType === 'STCG' ? lot.gain : 0
          const ltcg = lot.gainType === 'LTCG' ? lot.gain : 0
          symSTCG += stcg; symLTCG += ltcg
          groupSTCG += stcg; groupLTCG += ltcg
          tableBody.push([
            String(sno++),
            fmtQty(lot.qty),
            lot.purchaseDate,
            fmtINR(lot.purchaseCost),
            lot.sellDate,
            fmtINR(lot.saleValue),
            stcg !== 0 ? fmtINR(stcg) : '—',
            ltcg !== 0 ? fmtINR(ltcg) : '—',
          ])
        }
      }
      tableBody.push(['', '', '', '', 'Total', '', fmtINR(symSTCG), fmtINR(symLTCG)])

      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text(name, margin, curY)
      curY += 4

      const totalRowIdx = tableBody.length - 1
      autoTable(doc, {
        startY: curY,
        head: [colHeaders],
        body: tableBody,
        styles: { fontSize: 7, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 } },
        headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: colStyles,
        margin: { left: margin, right: margin },
        didParseCell: (data) => {
          if (data.section === 'body' && data.row.index === totalRowIdx) {
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.fillColor = [245, 245, 245]
          }
        },
      })

      curY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7
    }

    grandSTCG += groupSTCG
    grandLTCG += groupLTCG

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(
      `${groupLabel} Total — STCG: ${fmtINR(groupSTCG)}  LTCG: ${fmtINR(groupLTCG)}`,
      margin, curY
    )
    curY += 10
  }

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(`Grand Total — STCG: ${fmtINR(grandSTCG)}  LTCG: ${fmtINR(grandLTCG)}`, margin, curY)

  doc.save(`capital-gains-${fyLabel}.pdf`)
}
