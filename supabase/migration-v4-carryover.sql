-- Migration v4: carryover tracking for plan-to-plan rollover
-- Run in Supabase SQL Editor

-- Carryover amount per stock (leftover from previous FY, added to this stock's effective budget)
ALTER TABLE stock_allocations
  ADD COLUMN IF NOT EXISTS carryover_inr NUMERIC DEFAULT 0 NOT NULL;

-- Unallocated carryover on the FY itself (leftover from stocks dropped from previous plan)
ALTER TABLE fiscal_years
  ADD COLUMN IF NOT EXISTS unallocated_carryover_inr NUMERIC DEFAULT 0 NOT NULL;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
