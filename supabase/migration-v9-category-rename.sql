-- Migration v9: Update stock categories to match playbook v2 renames
-- Run in Supabase SQL Editor

-- LT: Asset-heavy Infra/Platforms → Capital Goods (has debt, now uses EV/EBITDA divergence check)
UPDATE stock_allocations
SET category = 'Capital Goods'
WHERE symbol = 'LT'
  AND category = 'Asset-heavy Infra/Platforms';

-- DMART: Retail → Retail — compounder (hist PE floor ~60x hardcoded)
UPDATE stock_allocations
SET category = 'Retail — compounder'
WHERE symbol = 'DMART'
  AND category = 'Retail';

-- Bulk rename for any other stocks using old category names
-- (safe to run even if no rows match)
UPDATE stock_allocations
SET category = 'Cap-Light Infra'
WHERE category = 'Capital-light Market Infra/Services';

UPDATE stock_allocations
SET category = 'Capital Goods'
WHERE category = 'Electricals/Capital Goods'
  AND symbol != 'LT';  -- LT already handled above

-- Verify
SELECT symbol, category
FROM stock_allocations
WHERE symbol IN ('LT', 'DMART', 'CAMS', 'IEX', 'POLYCAB')
ORDER BY symbol;
