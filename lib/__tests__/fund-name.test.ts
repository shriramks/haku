import { describe, expect, it } from 'vitest'
import { fundDisplayName } from '../fund-name'

describe('fundDisplayName', () => {
  it.each([
    ['Example Liquid Fund - Direct Plan - Growth', 'Example Liquid'],
    ['Example Sun Life Liquid Fund - Direct Plan - GROWTH', 'Example Sun Life Liquid'],
    ['Example S&P 500 Index Fund - Direct Plan - GROWTH', 'Example S&P 500 Index'],
    ['Example Flexi Cap Fund - Direct Plan - Growth', 'Example Flexi Cap'],
  ])('drops Fund, Direct Plan and Growth: %s', (input, out) => {
    expect(fundDisplayName(input)).toBe(out)
  })

  it('cleans AMFI hyphen typos so the result has no hyphens', () => {
    expect(fundDisplayName('Example ELSS- Tax Saver Fund - Direct Plan - Growth')).toBe('Example ELSS Tax Saver')
    expect(fundDisplayName('Example Prudential Liquid Fund - - Direct Plan - Growth')).toBe('Example Prudential Liquid')
    expect(fundDisplayName('EX - Liquid Fund - Direct Plan - Growth')).toBe('EX Liquid')
    expect(fundDisplayName('EX - Nifty Next 50 Index Fund - Direct Plan - Growth')).toBe('EX Nifty Next 50 Index')
  })

  it('leaves a name with no Fund or plan part unchanged', () => {
    expect(fundDisplayName('Example Total Stock Market US Specific Equity Passive FoF'))
      .toBe('Example Total Stock Market US Specific Equity Passive FoF')
  })

  it('shows a Regular plan as "Regular" and keeps other options', () => {
    expect(fundDisplayName('Example US Specific Equity Omni FoF - Regular Plan - Growth')).toBe('Example US Specific Equity Omni FoF Regular')
    expect(fundDisplayName('Example Treasury Advantage Fund - Direct Plan - IDCW Payout')).toBe('Example Treasury Advantage IDCW Payout')
  })

  it('does not eat the last word of "Fund of Fund"', () => {
    expect(fundDisplayName('Example Bluechip Fund of Fund - Direct Plan - Growth')).toBe('Example Bluechip Fund of Fund')
  })

  it('leaves names already saved short alone', () => {
    for (const n of ['Example Liquid', 'Example Arbitrage', 'Example Liquid Cash', 'Example Dynamic Debt Regular', 'Example Flexi Cap']) {
      expect(fundDisplayName(n)).toBe(n)
    }
  })
})
