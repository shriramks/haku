import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { LabeledInput } from '../../components/LabeledInput'

function render(el: React.ReactElement) {
  return renderToString(el)
}

const noop = () => {}

describe('LabeledInput — rendering', () => {
  it('renders the label', () => {
    expect(render(<LabeledInput label="EPS (₹)" value="" onChange={noop} />)).toContain('EPS (₹)')
  })

  it('renders the current value in the input', () => {
    expect(render(<LabeledInput label="EPS" value="18" onChange={noop} />)).toContain('value="18"')
  })

  it('renders the placeholder', () => {
    expect(render(<LabeledInput label="EPS" value="" onChange={noop} placeholder="e.g. 18" />)).toContain('placeholder="e.g. 18"')
  })

  it('defaults to a number input with decimal inputMode', () => {
    const html = render(<LabeledInput label="EPS" value="" onChange={noop} />)
    expect(html).toContain('type="number"')
    expect(html).toContain('inputMode="decimal"')
  })

  it('omits decimal inputMode for text type', () => {
    const html = render(<LabeledInput label="Name" value="" onChange={noop} type="text" />)
    expect(html).toContain('type="text"')
    expect(html).not.toContain('inputMode="decimal"')
  })
})

describe('LabeledInput — readOnly', () => {
  it('renders the value as static text without an input', () => {
    const html = render(<LabeledInput label="Implied EPS" value="12.34" readOnly />)
    expect(html).toContain('12.34')
    expect(html).not.toContain('<input')
  })
})

describe('LabeledInput — invalid border', () => {
  it('uses the warning colour border when invalid', () => {
    expect(render(<LabeledInput label="Multiplier" value="2" onChange={noop} invalid />)).toContain('var(--c-warning)')
  })

  it('uses the standard border when valid', () => {
    const html = render(<LabeledInput label="Multiplier" value="0.85" onChange={noop} />)
    expect(html).toContain('var(--border)')
    expect(html).not.toContain('var(--c-warning)')
  })
})

describe('LabeledInput — passthrough props', () => {
  it('forwards the step attribute', () => {
    expect(render(<LabeledInput label="Multiplier" value="" onChange={noop} step="0.01" />)).toContain('step="0.01"')
  })

  it('does not throw when onChange is a spy', () => {
    const spy = vi.fn()
    expect(() => render(<LabeledInput label="EPS" value="" onChange={spy} />)).not.toThrow()
  })
})
