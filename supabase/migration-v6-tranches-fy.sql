-- Migration v6: scope buy_tranches to a fiscal year
-- Run in Supabase SQL Editor

ALTER TABLE buy_tranches
  ADD COLUMN IF NOT EXISTS fy_id UUID REFERENCES fiscal_years(id);

-- Assign existing tranches to the earliest FY (FY25)
UPDATE buy_tranches
SET fy_id = (SELECT id FROM fiscal_years ORDER BY start_date ASC LIMIT 1)
WHERE fy_id IS NULL;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
