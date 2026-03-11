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
  { industry: 'life insurance',     category: 'Insurance — Life' },
  { industry: 'general insurance',  category: 'Insurance — General' },
  { industry: 'insurance',          category: 'Insurance — Life' },

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

  // Capital Goods (formerly Electricals/Capital Goods)
  { industry: 'electrical equipment', category: 'Capital Goods' },
  { industry: 'electric',           category: 'Capital Goods' },
  { industry: 'industrial electric', category: 'Capital Goods' },
  { industry: 'cable',              category: 'Capital Goods' },
  { industry: 'wire',               category: 'Capital Goods' },
  { industry: 'capital goods',      category: 'Capital Goods' },
  { industry: 'machinery',          category: 'Capital Goods' },
  { industry: 'engineering & construction', category: 'Capital Goods' },

  // Banks
  { industry: 'banks',              category: 'Banks' },
  { industry: 'banking',            category: 'Banks' },

  // Cap-Light Infra (formerly Capital-light Market Infra/Services)
  { industry: 'asset management',   category: 'Cap-Light Infra' },
  { industry: 'financial data',     category: 'Cap-Light Infra' },
  { industry: 'capital markets',    category: 'Cap-Light Infra' },
  { industry: 'depository',         category: 'Cap-Light Infra' },
  { industry: 'registrar',          category: 'Cap-Light Infra' },
  { industry: 'it services',        category: 'Cap-Light Infra' },
  { industry: 'information technology', category: 'Cap-Light Infra' },
  { industry: 'software',           category: 'Cap-Light Infra' },
  { sector: 'technology',           category: 'Cap-Light Infra' },
  { sector: 'financial services',   category: 'Cap-Light Infra' },
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
