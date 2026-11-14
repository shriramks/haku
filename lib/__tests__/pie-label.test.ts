import { describe, it, expect } from 'vitest'
import { pieLabelPlacement, labelBox, type PieGeometry } from '../pie-label'

const G: PieGeometry = { cx: 48, cy: 48, r: 44 }

describe('pieLabelPlacement', () => {
  it('puts a big slice\'s label at the preferred spot, full size', () => {
    const p = pieLabelPlacement(G, 0, 77, '77%')!
    expect(p.fontSize).toBe(9)
    expect(Math.hypot(p.x - 48, p.y - 48)).toBeCloseTo(44 * 0.6, 0)
  })
  it('fits the 77 / 13 / 10 split: every label box lies inside its own wedge', () => {
    let start = 0
    for (const pct of [77, 13, 10]) {
      const p = pieLabelPlacement(G, start, pct, `${pct}%`)
      expect(p, `${pct}% should get a label`).not.toBeNull()
      start += pct
    }
  })
  it('a label that does fit stays inside the circle and its wedge', () => {
    for (const split of [[60, 30, 10], [50, 25, 25], [88, 7, 5], [34, 33, 33], [100, 0, 0], [45, 45, 10]]) {
      let start = 0
      for (const pct of split) {
        const p = pieLabelPlacement(G, start, pct, `${pct}%`)
        if (p) {
          const { w, h } = labelBox(`${pct}%`, p.fontSize)
          expect(Math.hypot(Math.abs(p.x - 48) + w / 2, Math.abs(p.y - 48) + h / 2)).toBeLessThanOrEqual(44)
        }
        start += pct
      }
    }
  })
  it('draws no label rather than spill: a 2% sliver has no spot', () => {
    expect(pieLabelPlacement(G, 0, 2, '2%')).toBeNull()
  })
  it('draws nothing for an empty slice', () => expect(pieLabelPlacement(G, 50, 0, '0%')).toBeNull())
  it('a whole circle still gets its label', () => expect(pieLabelPlacement(G, 0, 100, '100%')).not.toBeNull())
})
