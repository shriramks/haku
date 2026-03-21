import { describe, it, expect } from 'vitest'
import { parseDate, parseCsv } from '../csv-parser'

describe('parseDate', () => {
  it('passes through YYYY-MM-DD unchanged', () => {
    expect(parseDate('2025-06-15')).toBe('2025-06-15')
  })

  it('converts DD-MMM-YYYY', () => {
    expect(parseDate('01-Apr-2025')).toBe('2025-04-01')
    expect(parseDate('31-Mar-2026')).toBe('2026-03-31')
    expect(parseDate('15-Dec-2024')).toBe('2024-12-15')
  })

  it('converts DD/MM/YYYY', () => {
    expect(parseDate('15/06/2025')).toBe('2025-06-15')
    expect(parseDate('01/04/2025')).toBe('2025-04-01')
  })

  it('returns null for unrecognised formats', () => {
    expect(parseDate('15-06-2025')).toBeNull()   // ambiguous — not supported
    expect(parseDate('2025/06/15')).toBeNull()
    expect(parseDate('invalid')).toBeNull()
    expect(parseDate('')).toBeNull()
  })

  it('handles leading/trailing whitespace', () => {
    expect(parseDate('  2025-06-15  ')).toBe('2025-06-15')
    expect(parseDate('  01-Apr-2025  ')).toBe('2025-04-01')
  })
})

describe('parseCsv', () => {
  const HEADER = 'symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time'

  it('parses a valid buy row', () => {
    const csv = [HEADER, 'INFY,,2025-06-15,NSE,EQ,EQ,buy,,50,1500.25,,,,'].join('\n')
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].symbol).toBe('INFY')
    expect(rows[0].exchange).toBe('NSE')
    expect(rows[0].trade_date).toBe('2025-06-15')
    expect(rows[0].trade_type).toBe('buy')
    expect(rows[0].quantity).toBe(50)
    expect(rows[0].price).toBe(1500.25)
    expect(rows[0].amount).toBe(50 * 1500.25)
    expect(rows[0].error).toBeUndefined()
  })

  it('parses a valid sell row', () => {
    const csv = [HEADER, 'TCS,,2025-07-01,BSE,EQ,EQ,sell,,10,3400,,,,'].join('\n')
    const rows = parseCsv(csv)
    expect(rows[0].trade_type).toBe('sell')
    expect(rows[0].exchange).toBe('BSE')
    expect(rows[0].error).toBeUndefined()
  })

  it('upper-cases symbol', () => {
    const csv = [HEADER, 'infy,,2025-06-15,NSE,EQ,EQ,buy,,50,1500,,,,'].join('\n')
    expect(parseCsv(csv)[0].symbol).toBe('INFY')
  })

  it('flags missing symbol', () => {
    const csv = [HEADER, ',,2025-06-15,NSE,EQ,EQ,buy,,50,1500,,,,'].join('\n')
    expect(parseCsv(csv)[0].error).toMatch(/missing symbol/)
  })

  it('flags bad date', () => {
    const csv = [HEADER, 'INFY,,15-06-2025,NSE,EQ,EQ,buy,,50,1500,,,,'].join('\n')
    expect(parseCsv(csv)[0].error).toMatch(/unrecognised date/)
  })

  it('flags unknown trade_type', () => {
    const csv = [HEADER, 'INFY,,2025-06-15,NSE,EQ,EQ,transfer,,50,1500,,,,'].join('\n')
    expect(parseCsv(csv)[0].error).toMatch(/unknown trade_type/)
  })

  it('flags invalid quantity', () => {
    const csv = [HEADER, 'INFY,,2025-06-15,NSE,EQ,EQ,buy,,0,1500,,,,'].join('\n')
    expect(parseCsv(csv)[0].error).toMatch(/invalid quantity/)
  })

  it('flags invalid price', () => {
    const csv = [HEADER, 'INFY,,2025-06-15,NSE,EQ,EQ,buy,,50,-5,,,,'].join('\n')
    expect(parseCsv(csv)[0].error).toMatch(/invalid price/)
  })

  it('returns empty array for header-only CSV', () => {
    expect(parseCsv(HEADER)).toHaveLength(0)
  })

  it('returns empty array for empty string', () => {
    expect(parseCsv('')).toHaveLength(0)
  })

  it('parses DD-MMM-YYYY date format from Zerodha', () => {
    const csv = [HEADER, 'RELIANCE,,01-Apr-2025,NSE,EQ,EQ,buy,,100,2800,,,,'].join('\n')
    expect(parseCsv(csv)[0].trade_date).toBe('2025-04-01')
    expect(parseCsv(csv)[0].error).toBeUndefined()
  })

  it('defaults exchange to NSE when empty', () => {
    const csv = [HEADER, 'INFY,,,,,EQ,buy,,50,1500,,,,'].join('\n')
    expect(parseCsv(csv)[0].exchange).toBe('NSE')
  })
})
