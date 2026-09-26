import { describe, it, expect } from 'vitest'
import { lastMarketClose, newestTimestamp, pricesAreStale, istDay, laggingDates, shortDate } from '../price-freshness'

// 2026-09-23 is a Wednesday; 3:30 pm IST = 10:00 UTC.
const z = (s: string) => new Date(s)

describe('lastMarketClose', () => {
  it('before today’s close → yesterday’s close', () => {
    // Wed 12:00 IST = 06:30Z
    expect(lastMarketClose(z('2026-09-23T06:30:00Z')).toISOString()).toBe('2026-09-22T10:00:00.000Z')
  })

  it('after today’s close → today’s close', () => {
    // Wed 16:00 IST = 10:30Z
    expect(lastMarketClose(z('2026-09-23T10:30:00Z')).toISOString()).toBe('2026-09-23T10:00:00.000Z')
  })

  it('exactly at the close counts as closed', () => {
    expect(lastMarketClose(z('2026-09-23T10:00:00Z')).toISOString()).toBe('2026-09-23T10:00:00.000Z')
  })

  it('late evening IST that is already the next UTC-earlier day still uses the same day’s close', () => {
    // Wed 01:30 IST Thu = Wed 20:00Z → Wednesday’s close
    expect(lastMarketClose(z('2026-09-23T20:00:00Z')).toISOString()).toBe('2026-09-23T10:00:00.000Z')
    // Thu 08:30 IST = Thu 03:00Z → still Wednesday’s close
    expect(lastMarketClose(z('2026-09-24T03:00:00Z')).toISOString()).toBe('2026-09-23T10:00:00.000Z')
  })

  it('weekends and Monday morning fall back to Friday’s close', () => {
    const fri = '2026-09-25T10:00:00.000Z'
    expect(lastMarketClose(z('2026-09-26T08:00:00Z')).toISOString()).toBe(fri) // Sat
    expect(lastMarketClose(z('2026-09-27T15:00:00Z')).toISOString()).toBe(fri) // Sun
    expect(lastMarketClose(z('2026-09-28T03:30:00Z')).toISOString()).toBe(fri) // Mon 09:00 IST, before the open
  })

  it('Monday after the close is Monday', () => {
    expect(lastMarketClose(z('2026-09-28T11:00:00Z')).toISOString()).toBe('2026-09-28T10:00:00.000Z')
  })
})

describe('pricesAreStale', () => {
  it('no saved price yet → stale', () => {
    expect(pricesAreStale(null, z('2026-09-23T12:00:00Z'))).toBe(true)
  })

  it('an unparseable timestamp is treated as stale', () => {
    expect(pricesAreStale('not-a-date', z('2026-09-23T12:00:00Z'))).toBe(true)
  })

  it('fetched before today’s close, checked after it → stale', () => {
    // fetched Wed 14:30 IST, now Wed 16:30 IST
    expect(pricesAreStale('2026-09-23T09:00:00Z', z('2026-09-23T11:00:00Z'))).toBe(true)
  })

  it('fetched after today’s close → fresh', () => {
    expect(pricesAreStale('2026-09-23T10:05:00Z', z('2026-09-23T11:00:00Z'))).toBe(false)
  })

  it('yesterday’s post-close fetch is still fresh the next morning (the last close is yesterday’s)', () => {
    // fetched Tue 21:15 IST (15:45Z); now Wed 09:00 IST (03:30Z)
    expect(pricesAreStale('2026-09-22T15:45:00Z', z('2026-09-23T03:30:00Z'))).toBe(false)
  })

  it('a Friday post-close fetch is fresh all weekend; a Friday intraday one is not', () => {
    expect(pricesAreStale('2026-09-25T10:30:00Z', z('2026-09-27T12:00:00Z'))).toBe(false)
    expect(pricesAreStale('2026-09-25T09:00:00Z', z('2026-09-27T12:00:00Z'))).toBe(true)
  })

  it('understands Supabase-style timestamps with a +00:00 offset', () => {
    expect(pricesAreStale('2026-09-23T10:05:00.123456+00:00', z('2026-09-23T11:00:00Z'))).toBe(false)
  })
})

describe('newestTimestamp', () => {
  it('picks the latest instant, ignoring nulls', () => {
    expect(newestTimestamp(['2026-09-22T10:00:00Z', null, '2026-09-23T10:00:00Z', undefined])).toBe('2026-09-23T10:00:00Z')
  })

  it('compares instants, not strings, across offsets', () => {
    // 10:00+00:00 is later than 15:00+05:30 (= 09:30Z) even though "15" > "10" as text
    expect(newestTimestamp(['2026-09-23T15:00:00+05:30', '2026-09-23T10:00:00+00:00'])).toBe('2026-09-23T10:00:00+00:00')
  })

  it('is null for nothing', () => {
    expect(newestTimestamp([])).toBeNull()
    expect(newestTimestamp([null, undefined, ''])).toBeNull()
  })
})

describe('istDay', () => {
  it('gives the IST calendar day, which can be a day ahead of UTC', () => {
    expect(istDay('2026-09-26T10:12:00Z')).toBe('2026-09-26')
    expect(istDay('2026-09-25T20:00:00Z')).toBe('2026-09-26') // 01:30 IST next day
    expect(istDay('2026-09-25T18:29:00Z')).toBe('2026-09-25') // 23:59 IST
  })

  it('is null when the timestamp does not parse', () => {
    expect(istDay('nope')).toBeNull()
  })
})

describe('laggingDates', () => {
  it('returns only the entries older than the newest, with their own date', () => {
    expect(laggingDates({ a: '2026-09-25', b: '2026-09-24', c: '2026-09-25', d: '2026-09-22' }))
      .toEqual({ b: '2026-09-24', d: '2026-09-22' })
  })

  it('is empty when everything shares a day, or there is one entry, or none', () => {
    expect(laggingDates({ a: '2026-09-25', b: '2026-09-25' })).toEqual({})
    expect(laggingDates({ a: '2026-09-25' })).toEqual({})
    expect(laggingDates({})).toEqual({})
  })
})

describe('shortDate', () => {
  it('formats as "24 Sep" with no zero padding', () => {
    expect(shortDate('2026-09-24')).toBe('24 Sep')
    expect(shortDate('2026-01-05')).toBe('5 Jan')
    expect(shortDate('2025-12-31')).toBe('31 Dec')
  })
})
