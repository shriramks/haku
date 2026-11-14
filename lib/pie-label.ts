// Where a percentage label goes inside a pie slice, and whether it fits there at all (Portfolio's allocation pie).
// A label is drawn only where its whole text box lies inside its wedge and inside the circle, so it can never spill
// over a neighbouring slice or off the pie.

export interface PieGeometry { cx: number; cy: number; r: number }
export interface PieLabel { x: number; y: number; fontSize: number }

/** Bold digits are about 0.62em wide, the % sign about 0.9em; digits are about 0.75em tall. */
export function labelBox(text: string, fontSize: number): { w: number; h: number } {
  const digits = (text.match(/\d/g) ?? []).length
  const signs = text.length - digits
  return { w: (digits * 0.62 + signs * 0.9) * fontSize, h: 0.75 * fontSize }
}

const PREFERRED_RADIUS = 0.6   // of r: where a label sits when there is room to spare
const MARGIN = 1.2             // viewBox units kept clear between the text box and the wedge edges / rim

/** True when the box centred at (x, y) is wholly inside the wedge [startDeg, startDeg + spanDeg] of the circle. */
function boxInsideWedge(g: PieGeometry, x: number, y: number, w: number, h: number, startDeg: number, spanDeg: number): boolean {
  if (spanDeg >= 359.5) return Math.hypot(Math.abs(x - g.cx) + w / 2, Math.abs(y - g.cy) + h / 2) <= g.r - MARGIN
  for (const dx of [-w / 2, w / 2]) for (const dy of [-h / 2, h / 2]) {
    const px = x + dx - g.cx, py = y + dy - g.cy
    const dist = Math.hypot(px, py)
    if (dist > g.r - MARGIN || dist < MARGIN) return false
    // Angular room is checked with the margin converted to an angle at this distance.
    const marginDeg = (Math.asin(Math.min(1, MARGIN / dist)) * 180) / Math.PI
    let a = (Math.atan2(py, px) * 180) / Math.PI - startDeg
    a = ((a % 360) + 360) % 360
    if (a < marginDeg || a > spanDeg - marginDeg) return false
  }
  return true
}

/**
 * The label spot for a slice that starts at `startPct` of the circle (0 = 12 o'clock) and covers `pct`. Tries the
 * biggest font first, and for each font the radii nearest the preferred one first; null when no spot fits, in
 * which case no label is drawn.
 */
export function pieLabelPlacement(
  g: PieGeometry, startPct: number, pct: number, text: string, fonts: number[] = [9, 8, 7, 6],
): PieLabel | null {
  if (pct <= 0) return null
  const startDeg = (startPct / 100) * 360 - 90
  const spanDeg = (pct / 100) * 360
  const midRad = ((startDeg + spanDeg / 2) * Math.PI) / 180
  const radii: number[] = []
  for (let f = 0.3; f <= 0.9; f += 0.02) radii.push(f)
  radii.sort((a, b) => Math.abs(a - PREFERRED_RADIUS) - Math.abs(b - PREFERRED_RADIUS))
  for (const fontSize of fonts) {
    const { w, h } = labelBox(text, fontSize)
    for (const f of radii) {
      const x = g.cx + g.r * f * Math.cos(midRad)
      const y = g.cy + g.r * f * Math.sin(midRad)
      if (boxInsideWedge(g, x, y, w, h, startDeg, spanDeg)) return { x, y, fontSize }
    }
  }
  return null
}
