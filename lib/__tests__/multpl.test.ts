import { afterEach, describe, it, expect, vi } from 'vitest'
import { parseMultplPe, checkSp500PeRange, checkPeFresh, fetchSp500Pe } from '../multpl'

const table = (rows: string) => `<table id="datatable"><caption><p>† Estimate</p></caption><tr><th>Date</th><th>Value</th></tr>${rows}</table>`
const row = (date: string, v: string) => `<tr class="odd"><td>${date}</td><td>\n<abbr title="Estimate">†</abbr>\n${v}\n</td></tr>`

afterEach(() => vi.unstubAllGlobals())

describe('parseMultplPe', () => {
  it('reads the latest row: value and date', () => {
    expect(parseMultplPe(table(row('Oct 30, 2026', '25.86') + row('Oct 1, 2026', '26.29')))).toEqual({ pe: 25.86, asOf: 'Oct 30, 2026' })
  })
  it('throws when the table is missing or has no numeric row', () => {
    expect(() => parseMultplPe('<html></html>')).toThrow()
    expect(() => parseMultplPe(table(''))).toThrow()
  })
})

describe('checkSp500PeRange', () => {
  it('accepts 14 to 35 inclusive', () => {
    expect(() => checkSp500PeRange(14)).not.toThrow()
    expect(() => checkSp500PeRange(35)).not.toThrow()
  })
  it('rejects values outside 14-35', () => {
    expect(() => checkSp500PeRange(13.9)).toThrow(/14/)
    expect(() => checkSp500PeRange(35.1)).toThrow(/35/)
    expect(() => checkSp500PeRange(NaN)).toThrow()
  })
})

describe('checkPeFresh', () => {
  const now = new Date('2026-11-04T12:00:00Z')
  it('accepts a reading a few days old (weekend, holiday)', () => {
    expect(() => checkPeFresh('Oct 30, 2026', now)).not.toThrow()
  })
  it('rejects a reading older than 10 days and an unreadable date', () => {
    expect(() => checkPeFresh('Oct 20, 2026', now)).toThrow(/stale/)
    expect(() => checkPeFresh('garbage', now)).toThrow(/unreadable/)
  })
})

describe('fetchSp500Pe', () => {
  const stub = (html: string, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 503, text: async () => html })))
  const now = new Date('2026-11-04T12:00:00Z')

  it('returns the guarded PE', async () => {
    stub(table(row('Oct 30, 2026', '25.86')))
    expect(await fetchSp500Pe(now)).toBe(25.86)
  })
  it('fails loudly on a bad PE, a stale page and a failed fetch', async () => {
    stub(table(row('Oct 30, 2026', '60.00')))
    await expect(fetchSp500Pe(now)).rejects.toThrow(/outside sane range/)
    stub(table(row('Aug 1, 2026', '25.86')))
    await expect(fetchSp500Pe(now)).rejects.toThrow(/stale/)
    stub('', false)
    await expect(fetchSp500Pe(now)).rejects.toThrow(/503/)
  })
})
