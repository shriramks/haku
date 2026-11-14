import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { AllocationSection, AllocationRowView } from '../../app/allocation/AllocationSection'
import { allocationSections, ppfLine, stockLine } from '../allocation-sections'
import type { StockRow } from '../types'

const FY = { total_budget_inr: 1_800_000, unallocated_carryover_inr: 200_000, equity_pct: 75, debt_pct: 25, gold_pct: 0 }
function row(symbol: string, budget: number, spent: number): StockRow {
  return { symbol, allocationPct: 0, budget, spent, remaining: budget - spent, pctRemaining: 0, qty: 0, avgCost: 0, currentCost: spent, cmp: null, unrealisedPnL: null, unrealisedPnLPct: null }
}

describe('AllocationRowView', () => {
  it('a stock row links to its stock page and shows Left and Invested with their %', () => {
    const html = renderToString(<AllocationRowView line={stockLine(row('NIFTYBEES', 600_000, 240_000), 'FY27')} />)
    expect(html).toContain('href="/stocks/NIFTYBEES?fy=FY27"')
    expect(html).toContain('NIFTYBEES')
    expect(html).toContain('3.6<span class="num-u">L</span>')    // left 3.6 L
    expect(html).toContain('2.4<span class="num-u">L</span>')    // invested 2.4 L
    expect(html).toContain('60<')                                  // left 60%
    expect(html).toContain('40<')                                  // invested 40%
  })
  it('the PPF row opens Portfolio', () => {
    const html = renderToString(<AllocationRowView line={ppfLine({ allocation_pct: 28 }, FY, 110_000)} />)
    expect(html).toContain('href="/portfolio"')
    expect(html).toContain('PPF')
    expect(html).toContain('30<span class="num-u">K</span>')    // 30 K left
  })
  it('has no caret: a caret on this screen always means collapse', () => {
    const html = renderToString(<AllocationRowView line={stockLine(row('ITC', 100, 10), 'FY27')} />)
    expect(html).not.toContain('<svg')
  })
  it('a finished row reads Complete and is dimmed', () => {
    const html = renderToString(<AllocationRowView line={stockLine(row('ITC', 375_000, 375_000), 'FY27')} />)
    expect(html).toContain('Complete')
    expect(html).toContain('opacity:0.35')
  })
  it('an over-spent row is also Complete (nothing left)', () => {
    expect(renderToString(<AllocationRowView line={stockLine(row('ITC', 100, 130), 'FY27')} />)).toContain('Complete')
  })
})

describe('AllocationSection', () => {
  const [equity] = allocationSections([stockLine(row('NIFTYBEES', 600_000, 240_000), 'FY27'), stockLine(row('ITC', 375_000, 150_000), 'FY27')], [])
  const render = () => renderToString(<AllocationSection section={equity}><i>ROWS</i></AllocationSection>)

  it('shows the sleeve name and its own Left and Invested, then its rows (open by default)', () => {
    const html = render()
    expect(html).toContain('Equity')
    expect(html).toContain('5.85<span class="num-u">L</span>')   // left: 975 000 - 390 000 = 585 000
    expect(html).toContain('3.9<span class="num-u">L</span>')    // invested 390 000
    expect(html).toContain('ROWS')
  })
  it('has the collapse caret, pointing down when open', () => {
    const html = render()
    expect(html).toContain('<svg')
    expect(html).toContain('rotate-90')
  })
  it('pins under the page header and the strip', () => {
    const html = render()
    expect(html).toContain('sticky')
    expect(html).toContain('var(--alloc-pin, 0px)')
  })
  it('is one tap target of at least 44px', () => expect(render()).toContain('min-height:44px'))
})
