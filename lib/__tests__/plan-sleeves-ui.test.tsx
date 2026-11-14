import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { SleeveSection, sleeveBadge } from '../../app/plan/SleeveSection'
import { SplitSheet } from '../../app/plan/SplitSheet'
import { PlanFigures } from '../../app/plan/PlanFigures'
import type { FiscalYear } from '../types'

const FY: FiscalYear = {
  id: 'fy', label: 'FY27', start_date: '2026-04-01', end_date: '2027-03-31',
  total_budget_inr: 1_800_000, unallocated_carryover_inr: 200_000, deploy_capital_inr: null,
  equity_pct: 75, debt_pct: 25, gold_pct: 0,
}
const noop = () => {}

describe('sleeveBadge', () => {
  it('says how much of the sleeve its rows leave free', () => {
    expect(sleeveBadge(75, 90)).toEqual({ label: '10% free', tone: 'free' })
    expect(sleeveBadge(25, 28)).toEqual({ label: '72% free', tone: 'free' })
  })
  it('says by how much the rows overshoot the sleeve', () => {
    expect(sleeveBadge(75, 120)).toEqual({ label: '120% · over', tone: 'over' })
  })
  it('is absent when the rows fill the sleeve exactly', () => expect(sleeveBadge(75, 100)).toBeNull())
  it('is absent for a sleeve with no money', () => {
    expect(sleeveBadge(0, 0)).toBeNull()
    expect(sleeveBadge(0, 40)).toBeNull()
  })
  it('reads 100% free for a sleeve that has money but no rows yet', () => {
    expect(sleeveBadge(25, 0)).toEqual({ label: '100% free', tone: 'free' })
  })
  it('keeps fractional free amounts exact', () => expect(sleeveBadge(50, 99.9)?.label).toBe('0.1% free'))
})

describe('SleeveSection', () => {
  const render = (props: Partial<React.ComponentProps<typeof SleeveSection>> = {}) => renderToString(
    <SleeveSection sleeve="equity" pct={75} amount={1_500_000} rowsTotal={90} hasRows onEditSplit={noop} {...props}>
      <i>ROW-CONTENT</i>
    </SleeveSection>)

  it('shows the sleeve name, its % and amount, and its rows (open by default)', () => {
    const html = render()
    expect(html).toContain('Equity')
    expect(html).toContain('75<!-- -->%')
    expect(html).toContain('15<span class="num-u">L</span>')
    expect(html).toContain('ROW-CONTENT')
  })
  it('shows the free badge', () => expect(render()).toContain('10% free'))
  it('has a caret when it has rows, and none when it has none', () => {
    expect(render()).toContain('<svg')
    expect(render({ hasRows: false })).not.toContain('<svg')
  })
  it('tapping the header edits the split: name, badge, % and amount are all inside ONE button', () => {
    const html = render()
    const first = html.match(/<button[^>]*>([\s\S]*?)<\/button>/)![1]
    expect(first).toContain('Equity')
    expect(first).toContain('10% free')
    expect(first).toContain('75<!-- -->%')
    expect(first).toContain('15<span class="num-u">L</span>')
  })
  it('only the caret collapses, in its own button with a label', () => {
    const html = render()
    const buttons = html.match(/<button[\s\S]*?<\/button>/g)!
    expect(buttons).toHaveLength(2)
    expect(buttons[1]).toContain('aria-label="Collapse Equity"')
    expect(buttons[1]).toContain('<svg')
    expect(buttons[1]).not.toContain('Equity</span>')   // the caret button carries no name: it only collapses
  })
  it('the caret button is a 44px hit area', () => {
    expect(render()).toMatch(/aria-label="Collapse Equity"[^>]*style="[^"]*width:44px;height:44px/)
  })
  it('a sleeve with no rows has no collapse button — the whole header just edits', () => {
    const html = render({ hasRows: false, sleeve: 'gold', pct: 0, amount: 0, rowsTotal: 0 })
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).not.toContain('aria-label')
  })
  it('reads over when the rows exceed the sleeve', () => {
    const html = render({ rowsTotal: 120 })
    expect(html).toContain('120% · over')
    expect(html).toContain('text-negative')
  })
  it('an empty Debt sleeve with money reads 100% free', () => {
    expect(render({ sleeve: 'debt', pct: 25, amount: 500_000, rowsTotal: 0, hasRows: false })).toContain('100% free')
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
