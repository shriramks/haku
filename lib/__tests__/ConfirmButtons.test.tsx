import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { ConfirmButtons } from '../../components/ConfirmButtons'

function render(el: React.ReactElement) {
  return renderToString(el)
}

const noop = () => {}

describe('ConfirmButtons — labels and message', () => {
  it('renders cancel and confirm labels', () => {
    const html = render(<ConfirmButtons cancelLabel="No" confirmLabel="Delete" onCancel={noop} onConfirm={noop} />)
    expect(html).toContain('No')
    expect(html).toContain('Delete')
  })

  it('renders the message when provided', () => {
    const html = render(<ConfirmButtons message="Transactions kept" cancelLabel="Keep" confirmLabel="Remove" onCancel={noop} onConfirm={noop} />)
    expect(html).toContain('Transactions kept')
  })

  it('omits the message paragraph when not provided', () => {
    const html = render(<ConfirmButtons cancelLabel="Cancel" confirmLabel="Remove all?" onCancel={noop} onConfirm={noop} />)
    expect(html).not.toContain('flex-1')
  })

  it('merges extra className onto the row', () => {
    const html = render(<ConfirmButtons className="px-4 py-3" cancelLabel="Cancel" confirmLabel="Remove all?" onCancel={noop} onConfirm={noop} />)
    expect(html).toContain('px-4 py-3')
  })
})

describe('ConfirmButtons — variant', () => {
  it('negative (default) uses text-negative on confirm', () => {
    const html = render(<ConfirmButtons cancelLabel="No" confirmLabel="Delete" onCancel={noop} onConfirm={noop} />)
    expect(html).toContain('text-negative')
    expect(html).not.toContain('text-accent')
  })

  it('primary uses text-accent on confirm', () => {
    const html = render(<ConfirmButtons cancelLabel="No" confirmLabel="OK" onCancel={noop} onConfirm={noop} variant="primary" />)
    expect(html).toContain('text-accent')
    expect(html).not.toContain('text-negative')
  })
})

describe('ConfirmButtons — loading and disabled', () => {
  it('loading renders … instead of confirm label and disables', () => {
    const html = render(<ConfirmButtons cancelLabel="Keep" confirmLabel="Remove" onCancel={noop} onConfirm={noop} loading />)
    expect(html).toContain('…')
    expect(html).not.toContain('>Remove<')
    expect(html).toContain('disabled=""')
  })

  it('disabled prop disables confirm without changing label', () => {
    const html = render(<ConfirmButtons cancelLabel="Keep" confirmLabel="Remove" onCancel={noop} onConfirm={noop} disabled />)
    expect(html).toContain('disabled=""')
    expect(html).toContain('Remove')
  })

  it('is not disabled by default', () => {
    const html = render(<ConfirmButtons cancelLabel="Keep" confirmLabel="Remove" onCancel={noop} onConfirm={noop} />)
    expect(html).not.toContain('disabled=""')
  })
})
