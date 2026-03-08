-- v8: Add AI provider selection to user_settings
-- Run in Supabase SQL editor

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'gemini',
  ADD COLUMN IF NOT EXISTS claude_api_key TEXT;
