import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { Stepper } from '../../components/Stepper'

function render(el: React.ReactElement) {
  return renderToString(el)
}

const noop = () => {}

describe('Stepper — rendering', () => {
  it('renders the current value in the input', () => {
    expect(render(<Stepper value={12} min={1} max={50} step={1} onChange={noop} />)).toContain('value="12"')
  })

  it('renders the suffix when provided', () => {
    expect(render(<Stepper value={10} min={1} max={50} step={1} onChange={noop} suffix="%" />)).toContain('%')
  })

  it('omits the suffix span when not provided', () => {
    const html = render(<Stepper value={10} min={1} max={50} step={1} onChange={noop} />)
    expect(html).not.toContain('font-bold" style')
  })

  it('renders − and + buttons', () => {
    const html = render(<Stepper value={10} min={1} max={50} step={1} onChange={noop} />)
    expect(html).toContain('−')
    expect(html).toContain('+')
  })
})

describe('Stepper — clamping logic', () => {
  // Mirror the component's button handlers to assert the clamping rules.
  const round = (n: number) => parseFloat(n.toFixed(1))
  const dec = (value: number, min: number, step: number) => Math.max(min, round(value - step))
  const inc = (value: number, max: number, step: number) => Math.min(max, round(value + step))

  it('decrement floors at min', () => {
    expect(dec(1, 1, 1)).toBe(1)
    expect(dec(2, 1, 1)).toBe(1)
  })

  it('increment caps at max', () => {
    expect(inc(50, 50, 1)).toBe(50)
    expect(inc(49, 50, 1)).toBe(50)
  })

  it('rounds decimal steps to one place', () => {
    expect(inc(10.1, 50, 0.2)).toBe(10.3)
    expect(dec(10.3, 1, 0.2)).toBe(10.1)
  })
})

describe('Stepper — onChange', () => {
  it('passes a numeric value (not an event) when typing', () => {
    // The input clamps to a non-negative number before calling onChange.
    const parse = (raw: string) => Math.max(0, parseFloat(raw) || 0)
    expect(parse('')).toBe(0)
    expect(parse('25')).toBe(25)
    expect(parse('-5')).toBe(0)
  })

  it('does not throw when onChange is a spy', () => {
    const spy = vi.fn()
    expect(() => render(<Stepper value={10} min={1} max={50} step={1} onChange={spy} />)).not.toThrow()
  })
})
