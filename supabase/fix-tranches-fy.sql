-- Fix: Move tranches from the wrong fiscal year to the current one
-- Run this in Supabase SQL Editor if your FY25 tranches appear under FY26.
--
-- This moves all tranches from the LATEST fiscal year to the one whose
-- date range contains today (the active fiscal year).
--
-- SAFE to run multiple times — only moves tranches if there's a mismatch.

UPDATE buy_tranches
SET fy_id = (
  SELECT id FROM fiscal_years
  WHERE start_date <= CURRENT_DATE AND CURRENT_DATE <= end_date
  LIMIT 1
)
WHERE fy_id = (
  SELECT id FROM fiscal_years ORDER BY start_date DESC LIMIT 1
)
AND (
  SELECT id FROM fiscal_years ORDER BY start_date DESC LIMIT 1
) != (
  SELECT id FROM fiscal_years
  WHERE start_date <= CURRENT_DATE AND CURRENT_DATE <= end_date
  LIMIT 1
);
