import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { SleeveSection, PLAN_COLS } from '../../app/plan/SleeveSection'
import { PlanRow, RemainderRow } from '../../app/plan/PlanRow'
import { SplitSheet } from '../../app/plan/SplitSheet'
import { PlanFigures } from '../../app/plan/PlanFigures'
import { FundResult } from '../../app/plan/FundResult'
import { remainderLine } from '../sleeves'
import type { FiscalYear, StockAllocation } from '../types'

const FY: FiscalYear = {
  id: 'fy', label: 'FY27', start_date: '2026-04-01', end_date: '2027-03-31',
  total_budget_inr: 1_800_000, unallocated_carryover_inr: 200_000, deploy_capital_inr: null,
  equity_pct: 75, debt_pct: 25, gold_pct: 0,
}
const noop = () => {}
const ALLOC: StockAllocation = { id: 'a', fy_id: 'fy', symbol: 'NIFTYBEES', exchange: 'NSE', kind: 'stock', allocation_pct: 40, category: 'x', name: 'Nippon India ETF Nifty 50' }

describe('remainderLine', () => {
  it('is null when the shares add up to exactly 100', () => expect(remainderLine(100, 1_500_000)).toBeNull())
  it('is the unassigned share and its amount when they fall short', () => {
    expect(remainderLine(90, 1_500_000)).toEqual({ kind: 'unassigned', pct: 10, amount: 150_000 })
    expect(remainderLine(28, 500_000)?.pct).toBe(72)
  })
  it('is a negative remainder, in red terms, when they overshoot', () => {
    expect(remainderLine(120, 1_500_000)).toEqual({ kind: 'over', pct: -20, amount: -300_000 })
  })
  it('keeps fractional shares exact', () => expect(remainderLine(99.9, 1_000_000)?.pct).toBe(0.1))
  it('works on the pool too: sleeves that split 95 leave 5 unassigned', () => {
    expect(remainderLine(95, 2_000_000)).toEqual({ kind: 'unassigned', pct: 5, amount: 100_000 })
  })
})

describe('SleeveSection', () => {
  const render = (props: Partial<React.ComponentProps<typeof SleeveSection>> = {}) => renderToString(
    <SleeveSection sleeve="equity" pct={75} amount={1_500_000} hasRows onEditSplit={noop} {...props}>
      <i>ROW-CONTENT</i>
    </SleeveSection>)

  it('shows the sleeve name, its share and amount, and its rows (open by default)', () => {
    const html = render()
    expect(html).toContain('Equity')
    expect(html).toContain('75<!-- -->%')
    expect(html).toContain('15<span class="num-u">L</span>')
    expect(html).toContain('ROW-CONTENT')
  })
  it('uses the Plan grid: name | share | amount, the same columns as Allocation', () => {
    expect(PLAN_COLS).toBe('1.4fr 1fr 1.2fr')
    expect(render()).toContain('grid-template-columns:1.4fr 1fr 1.2fr')
  })
  it('tapping the header edits the split: name, share and amount are all inside ONE button', () => {
    const first = render().match(/<button[^>]*>([\s\S]*?)<\/button>/)![1]
    expect(first).toContain('Equity')
    expect(first).toContain('75<!-- -->%')
    expect(first).toContain('15<span class="num-u">L</span>')
  })
  it('only the caret collapses, in its own labelled 44px button', () => {
    const html = render()
    const buttons = html.match(/<button[\s\S]*?<\/button>/g)!
    expect(buttons).toHaveLength(2)
    expect(buttons[1]).toContain('aria-label="Collapse Equity"')
    expect(buttons[1]).toContain('<svg')
    expect(buttons[1]).not.toContain('Equity</span>')
    expect(html).toMatch(/aria-label="Collapse Equity"[^>]*style="[^"]*width:44px;height:44px/)
  })
  it('a sleeve with no rows has no collapse button — the whole header just edits', () => {
    const html = render({ hasRows: false, sleeve: 'gold', pct: 0, amount: 0 })
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).not.toContain('aria-label')
  })
  it('there is no badge any more: free money is a line under the rows', () => {
    expect(render()).not.toContain('free')
  })
})

describe('PlanRow', () => {
  const render = () => renderToString(<PlanRow alloc={ALLOC} budget={600_000} onEdit={noop} />)
  it('is one line: the name, its share (blue) and its amount, on the Plan grid', () => {
    const html = render()
    expect(html).toContain('NIFTYBEES')
    expect(html).toContain('40<!-- -->%')
    expect(html).toContain('6<span class="num-u">L</span>')
    expect(html).toContain('grid-template-columns:1.4fr 1fr 1.2fr')
  })
  it('has no second line: no company name, no carryover split', () => {
    const html = render()
    expect(html).not.toContain('Nippon')
    expect(html).not.toContain('base')
  })
  it('has no caret (a caret on this screen means collapse), but keeps the slot so amounts align with the header', () => {
    const html = render()
    expect(html).not.toContain('<svg')
    expect(html).toContain('w-4 h-4 flex-shrink-0')
  })
})

describe('RemainderRow', () => {
  it('Unassigned reads muted, with its share and amount on the grid', () => {
    const html = renderToString(<RemainderRow line={{ kind: 'unassigned', pct: 10, amount: 150_000 }} />)
    expect(html).toContain('Unassigned')
    expect(html).toContain('10<span class="num-u">%</span>')
    expect(html).toContain('1.5<span class="num-u">L</span>')
    expect(html).not.toContain('c-negative')
  })
  it('Over reads red and signed', () => {
    const html = renderToString(<RemainderRow line={{ kind: 'over', pct: -20, amount: -300_000 }} />)
    expect(html).toContain('Over')
    expect(html).toContain('c-negative')
    expect(html).toContain('<span class="num-sgn">−</span>20<span class="num-u">%</span>')
    expect(html).toContain('<span class="num-sgn">−</span>3<span class="num-u">L</span>')
  })
})

describe('SplitSheet', () => {
  const render = (fy: FiscalYear) => renderToString(<SplitSheet fy={fy} pool={2_000_000} onClose={noop} onSave={async () => null} />)

  it('shows all three sleeves with their % and amounts', () => {
    const html = render(FY)
    for (const name of ['Equity', 'Debt', 'Gold']) expect(html).toContain(name)
    expect(html).toContain('value="75"')
    expect(html).toContain('value="25"')
    expect(html).toContain('value="0"')
    expect(html).toContain('15<span class="num-u">L</span>')   // 75% of a 20 L pool
    expect(html).toContain('5<span class="num-u">L</span>')    // 25%
  })
  it('totals the split', () => expect(render(FY)).toMatch(/Plan total[\s\S]*?>100<[\s\S]*?%/))
  it('a total over 100 shows red', () => {
    const html = render({ ...FY, equity_pct: 60, debt_pct: 40, gold_pct: 20 })
    expect(html).toMatch(/c-negative[^>]*><span class="num-col"><span class="num-digits">120</)
  })
  it('nothing is disabled: Save has no disabled attribute even over 100', () => {
    const html = render({ ...FY, equity_pct: 60, debt_pct: 40, gold_pct: 20 })
    expect(html).toContain('>Save<')
    expect(html).not.toMatch(/<button[^>]*\sdisabled(=|\s|>)[^>]*>Save/)
  })
  it('an FY with no split set opens as all Equity', () => {
    const html = render({ ...FY, equity_pct: undefined as unknown as number, debt_pct: undefined as unknown as number, gold_pct: undefined as unknown as number })
    expect(html).toContain('value="100"')
  })
})

describe('PlanFigures tone', () => {
  it('colours a pct total over 100 red and 100 or under plain', () => {
    const over = renderToString(<PlanFigures rows={[{ label: 'Equity total', now: { pct: 110 }, tone: true }]} />)
    const ok = renderToString(<PlanFigures rows={[{ label: 'Equity total', now: { pct: 100 }, tone: true }]} />)
    expect(over).toContain('c-negative')
    expect(ok).not.toContain('c-negative')
  })
})

describe('fund rows', () => {
  const FUND: StockAllocation = { id: 'f', fy_id: 'fy', symbol: '100001', exchange: 'AMFI', kind: 'mf', allocation_pct: 20, category: '', name: 'Example Liquid' }
  it('a fund row shows its name, not the scheme code', () => {
    const html = renderToString(<PlanRow alloc={FUND} budget={100_000} onEdit={noop} />)
    expect(html).toContain('Example Liquid')
    expect(html).not.toContain('100001')
  })
  const scheme = { code: '100001', name: 'Example Liquid Fund - Direct Plan - Growth', type: 'Debt Scheme - Liquid Fund' }
  it('a search result shows the class line and can be picked', () => {
    const html = renderToString(<FundResult scheme={scheme} inPlan={false} onPick={noop} />)
    expect(html).toContain('Debt · Liquid Fund')
    expect(html).not.toContain('In plan')
    expect(html).not.toContain('disabled')
  })
  it('a fund already in the plan is marked and cannot be tapped', () => {
    const html = renderToString(<FundResult scheme={scheme} inPlan onPick={noop} />)
    expect(html).toContain('In plan')
    expect(html).toContain('disabled')
  })
})
