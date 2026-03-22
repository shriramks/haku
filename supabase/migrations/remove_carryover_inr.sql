-- Remove carryover_inr from stock_allocations.
-- Per-stock carryover is now computed at runtime from previous FY actuals
-- via computeCarryover() in lib/compute.ts — no longer stored in the DB.

ALTER TABLE stock_allocations DROP COLUMN IF EXISTS carryover_inr;
