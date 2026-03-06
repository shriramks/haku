import type { StockCategory } from './types'

/**
 * Maps Yahoo Finance sector + industry strings to our StockCategory.
 * Matching is case-insensitive substring. First match wins.
 */
const RULES: { sector?: string; industry?: string; category: StockCategory }[] = [
  // Defence
  { industry: 'aerospace',          category: 'Defence' },
  { industry: 'defense',            category: 'Defence' },
  { industry: 'defence',            category: 'Defence' },

  // Insurance
  { industry: 'insurance',          category: 'Insurance' },
  { industry: 'life insurance',     category: 'Insurance' },

  // Hospitals
  { industry: 'medical care',       category: 'Hospitals' },
  { industry: 'health care facilit', category: 'Hospitals' },
  { industry: 'hospital',           category: 'Hospitals' },
  { industry: 'diagnostics',        category: 'Hospitals' },

  // Pharma
  { industry: 'drug manufacturer',  category: 'Pharma' },
  { industry: 'pharmaceutical',     category: 'Pharma' },
  { industry: 'biotechnology',      category: 'Pharma' },
  { sector: 'healthcare',           category: 'Pharma' },   // fallback for healthcare

  // Auto
  { industry: 'auto manufacturer',  category: 'Auto OEM' },
  { industry: 'automobile',         category: 'Auto OEM' },
  { industry: 'auto parts',         category: 'Auto OEM' },
  { sector: 'consumer cyclical',    industry: 'auto', category: 'Auto OEM' },

  // Retail
  { industry: 'retail',             category: 'Retail' },
  { industry: 'grocery',            category: 'Retail' },
  { industry: 'hypermarket',        category: 'Retail' },

  // FMCG
  { industry: 'packaged foods',     category: 'FMCG' },
  { industry: 'beverages',          category: 'FMCG' },
  { industry: 'tobacco',            category: 'FMCG' },
  { industry: 'household',          category: 'FMCG' },
  { industry: 'personal products',  category: 'FMCG' },
  { sector: 'consumer defensive',   category: 'FMCG' },     // fallback

  // Electricals / Capital Goods
  { industry: 'electrical equipment', category: 'Electricals/Capital Goods' },
  { industry: 'electric',           category: 'Electricals/Capital Goods' },
  { industry: 'industrial electric', category: 'Electricals/Capital Goods' },
  { industry: 'cable',              category: 'Electricals/Capital Goods' },
  { industry: 'wire',               category: 'Electricals/Capital Goods' },
  { industry: 'capital goods',      category: 'Electricals/Capital Goods' },
  { industry: 'machinery',          category: 'Electricals/Capital Goods' },

  // Asset-heavy Infra / Platforms
  { industry: 'engineering & construction', category: 'Asset-heavy Infra/Platforms' },
  { industry: 'construction',       category: 'Asset-heavy Infra/Platforms' },
  { industry: 'infrastructure',     category: 'Asset-heavy Infra/Platforms' },
  { industry: 'utilities',          category: 'Asset-heavy Infra/Platforms' },
  { industry: 'exchange',           category: 'Asset-heavy Infra/Platforms' },
  { industry: 'power',              category: 'Asset-heavy Infra/Platforms' },
  { sector: 'utilities',            category: 'Asset-heavy Infra/Platforms' },

  // Capital-light Market Infra / Services
  { industry: 'asset management',   category: 'Capital-light Market Infra/Services' },
  { industry: 'financial data',     category: 'Capital-light Market Infra/Services' },
  { industry: 'capital markets',    category: 'Capital-light Market Infra/Services' },
  { industry: 'depository',         category: 'Capital-light Market Infra/Services' },
  { industry: 'registrar',          category: 'Capital-light Market Infra/Services' },
  { industry: 'it services',        category: 'Capital-light Market Infra/Services' },
  { industry: 'information technology', category: 'Capital-light Market Infra/Services' },
  { industry: 'software',           category: 'Capital-light Market Infra/Services' },
  { sector: 'technology',           category: 'Capital-light Market Infra/Services' },
  { sector: 'financial services',   category: 'Capital-light Market Infra/Services' },
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
