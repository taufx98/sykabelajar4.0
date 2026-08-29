-- Add pembina (mentor/coach) column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pembina text DEFAULT '';
