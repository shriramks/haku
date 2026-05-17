export type Zone = 'DEEP_VALUE' | 'BUY' | 'MID' | 'WATCH' | 'TRIM'
export type CondResult = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA'
export type Signal = 'ADD_AGGRESSIVE' | 'ADD_MEASURED' | 'WAIT' | 'BLOCK' | 'INSUFFICIENT_DATA'
export type EntryStrengthLabel = 'STRONG' | 'MODERATE' | 'WEAK'

export interface SnowballInput {
  cmp: number
  buyLow: number
  buyHigh: number
  midLow: number
  midHigh: number
  trim: number
  g: number | null              // current 3yr PAT CAGR
  opMarginNow: number | null    // current op profit / revenue
  gPrior: number | null         // g from prior snapshot
  opMarginPrior: number | null  // opMargin from prior snapshot
}

export interface SnowballResult {
  zone: Zone
  cond1: CondResult   // g > 12% CAGR
  cond2: CondResult   // opMargin improving (now > prior)
  cond3: CondResult   // g > gPrior (growth momentum holding)
  entryStrength: number | null
  entryStrengthLabel: EntryStrengthLabel | null
  signal: Signal
}

function classifyZone(cmp: number, buyLow: number, buyHigh: number, midLow: number, midHigh: number, trim: number): Zone {
  if (cmp > trim) return 'TRIM'
  if (cmp >= midLow && cmp <= midHigh) return 'MID'
  if (cmp >= buyLow && cmp <= buyHigh) return 'BUY'
  if (cmp < buyLow) return 'DEEP_VALUE'
  return 'WATCH'
}

function strengthLabel(n: number): EntryStrengthLabel {
  if (n === 3) return 'STRONG'
  if (n === 2) return 'MODERATE'
  return 'WEAK'
}

export function computeSnowball(input: SnowballInput): SnowballResult {
  const { cmp, buyLow, buyHigh, midLow, midHigh, trim, g, opMarginNow, gPrior, opMarginPrior } = input

  const zone = classifyZone(cmp, buyLow, buyHigh, midLow, midHigh, trim)

  const cond1: CondResult = g === null ? 'INSUFFICIENT_DATA' : g > 0.12 ? 'PASS' : 'FAIL'
  const cond2: CondResult = opMarginNow === null || opMarginPrior === null
    ? 'INSUFFICIENT_DATA'
    : opMarginNow > opMarginPrior ? 'PASS' : 'FAIL'
  const cond3: CondResult = g === null || gPrior === null
    ? 'INSUFFICIENT_DATA'
    : g > gPrior ? 'PASS' : 'FAIL'

  if (zone === 'TRIM') {
    return { zone, cond1, cond2, cond3, entryStrength: null, entryStrengthLabel: null, signal: 'BLOCK' }
  }

  const hasInsufficientData = cond1 === 'INSUFFICIENT_DATA' || cond2 === 'INSUFFICIENT_DATA' || cond3 === 'INSUFFICIENT_DATA'

  if (hasInsufficientData) {
    return { zone, cond1, cond2, cond3, entryStrength: null, entryStrengthLabel: null, signal: 'INSUFFICIENT_DATA' }
  }

  if (zone === 'MID' || zone === 'WATCH') {
    return { zone, cond1, cond2, cond3, entryStrength: null, entryStrengthLabel: null, signal: 'WAIT' }
  }

  // BUY or DEEP_VALUE
  const entryStrength = [cond1, cond2, cond3].filter(c => c === 'PASS').length
  const entryStrengthLabel = strengthLabel(entryStrength)

  let signal: Signal
  if (entryStrength === 3) signal = 'ADD_AGGRESSIVE'
  else if (entryStrength >= 1) signal = 'ADD_MEASURED'
  else signal = 'WAIT'

  return { zone, cond1, cond2, cond3, entryStrength, entryStrengthLabel, signal }
}
