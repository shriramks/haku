import type { StockCategory } from './types'

/**
 * Maps Yahoo Finance sector + industry strings to our StockCategory.
 * Matching is case-insensitive substring. First match wins.
 */
const RULES: { sector?: string; industry?: string; category: StockCategory }[] = [
  // Hospitals
  { industry: 'medical care',            category: 'Hospitals' },
  { industry: 'health care facilit',     category: 'Hospitals' },
  { industry: 'hospital',               category: 'Hospitals' },
  { industry: 'diagnostics',            category: 'Hospitals' },

  // FMCG
  { industry: 'packaged foods',         category: 'FMCG' },
  { industry: 'household products',     category: 'FMCG' },
  { industry: 'personal products',      category: 'FMCG' },
  { sector: 'consumer defensive',       category: 'FMCG' },

  // Cap-Light Infra
  { industry: 'asset management',       category: 'Cap-Light Infra' },
  { industry: 'financial data',         category: 'Cap-Light Infra' },
  { industry: 'capital markets',        category: 'Cap-Light Infra' },
  { industry: 'depository',             category: 'Cap-Light Infra' },
  { industry: 'registrar',              category: 'Cap-Light Infra' },
  { sector: 'financial services',       category: 'Cap-Light Infra' },
]

export function categoryFromSector(sector: string, industry: string): StockCategory | null {
  const s = sector.toLowerCase()
  const i = industry.toLowerCase()

  for (const rule of RULES) {
    const sectorMatch   = !rule.sector   || s.includes(rule.sector.toLowerCase())
    const industryMatch = !rule.industry || i.includes(rule.industry.toLowerCase())
    if (sectorMatch && industryMatch) return rule.category
  }
  return null
}
