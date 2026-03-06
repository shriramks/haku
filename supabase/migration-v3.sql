-- Migration v3: add two_strong_quarters to stock_allocations
ALTER TABLE stock_allocations
  ADD COLUMN IF NOT EXISTS two_strong_quarters BOOLEAN NOT NULL DEFAULT false;
