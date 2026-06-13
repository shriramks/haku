import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { ChipGroup } from '../../components/ChipGroup'

function render(el: React.ReactElement) {
  return renderToString(el)
}

const noop = () => {}

describe('ChipGroup — rendering', () => {
  it('renders one button per item', () => {
    const html = render(<ChipGroup items={['INFY', 'TCS', 'WIPRO']} selected={null} onSelect={noop} />)
    expect(html).toContain('INFY')
    expect(html).toContain('TCS')
    expect(html).toContain('WIPRO')
    expect((html.match(/type="button"/g) ?? []).length).toBe(3)
  })

  it('renders nothing visible for an empty list', () => {
    const html = render(<ChipGroup items={[]} selected={null} onSelect={noop} />)
    expect(html).not.toContain('type="button"')
  })
})

describe('ChipGroup — selection styling', () => {
  it('positive variant tints the selected chip with the positive colour', () => {
    const html = render(<ChipGroup items={['INFY']} selected="INFY" onSelect={noop} variant="positive" />)
    expect(html).toContain('var(--c-positive)')
    expect(html).not.toContain('var(--c-negative)')
  })

  it('negative variant tints the selected chip with the negative colour', () => {
    const html = render(<ChipGroup items={['INFY']} selected="INFY" onSelect={noop} variant="negative" />)
    expect(html).toContain('var(--c-negative)')
    expect(html).not.toContain('var(--c-positive)')
  })

  it('defaults to the positive variant', () => {
    expect(render(<ChipGroup items={['INFY']} selected="INFY" onSelect={noop} />)).toContain('var(--c-positive)')
  })

  it('unselected chips use the tertiary background', () => {
    const html = render(<ChipGroup items={['INFY']} selected={null} onSelect={noop} variant="positive" />)
    expect(html).toContain('var(--bg-tertiary)')
    expect(html).not.toContain('var(--c-positive)')
  })
})

describe('ChipGroup — onSelect', () => {
  it('does not throw when onSelect is a spy', () => {
    const spy = vi.fn()
    expect(() => render(<ChipGroup items={['INFY']} selected={null} onSelect={spy} />)).not.toThrow()
  })
})
