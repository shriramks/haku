import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { Button } from '../../components/Button'

function render(el: React.ReactElement) {
  return renderToString(el)
}

describe('Button — primary variant (default)', () => {
  it('renders children', () => {
    expect(render(<Button>Save</Button>)).toContain('Save')
  })

  it('includes core primary classes', () => {
    const html = render(<Button>Save</Button>)
    expect(html).toContain('bg-accent')
    expect(html).toContain('text-white')
    expect(html).toContain('rounded-xl')
    expect(html).toContain('text-headline')
  })

  it('is not disabled by default', () => {
    expect(render(<Button>Save</Button>)).not.toContain('disabled=""')
  })

  it('fullWidth adds w-full class', () => {
    expect(render(<Button fullWidth>Save</Button>)).toContain('w-full')
  })

  it('without fullWidth does not add w-full', () => {
    expect(render(<Button>Save</Button>)).not.toContain('w-full')
  })

  it('merges extra className', () => {
    expect(render(<Button className="mt-2">Save</Button>)).toContain('mt-2')
  })
})

describe('Button — loading state', () => {
  it('renders … instead of children when loading', () => {
    const html = render(<Button loading>Save</Button>)
    expect(html).toContain('…')
    expect(html).not.toContain('Save')
  })

  it('sets disabled when loading', () => {
    expect(render(<Button loading>Save</Button>)).toContain('disabled=""')
  })

  it('sets disabled when disabled prop is true', () => {
    expect(render(<Button disabled>Save</Button>)).toContain('disabled=""')
  })

  it('renders children normally when not loading', () => {
    const html = render(<Button loading={false}>Save</Button>)
    expect(html).toContain('Save')
    expect(html).not.toContain('…')
  })
})

describe('Button — secondary variant', () => {
  it('includes text-accent class', () => {
    expect(render(<Button variant="secondary">Cancel</Button>)).toContain('text-accent')
  })

  it('does not include bg-accent class', () => {
    expect(render(<Button variant="secondary">Cancel</Button>)).not.toContain('bg-accent')
  })

  it('renders children', () => {
    expect(render(<Button variant="secondary">Cancel</Button>)).toContain('Cancel')
  })

  it('loading renders … and disables', () => {
    const html = render(<Button variant="secondary" loading>Save</Button>)
    expect(html).toContain('…')
    expect(html).toContain('disabled=""')
  })
})

describe('Button — destructive variant', () => {
  it('includes text-negative class', () => {
    expect(render(<Button variant="destructive">Delete</Button>)).toContain('text-negative')
  })

  it('does not include bg-accent or text-accent', () => {
    const html = render(<Button variant="destructive">Delete</Button>)
    expect(html).not.toContain('bg-accent')
    expect(html).not.toContain('text-accent')
  })

  it('renders children', () => {
    expect(render(<Button variant="destructive">Delete</Button>)).toContain('Delete')
  })
})

describe('Button — style and type passthrough', () => {
  it('passes style prop through', () => {
    const html = render(<Button style={{ background: 'var(--border)' }}>X</Button>)
    expect(html).toContain('var(--border)')
  })

  it('passes type="submit" through', () => {
    const html = render(<Button type="submit">Submit</Button>)
    expect(html).toContain('type="submit"')
  })
})
