-- Add title and description to chat_threads
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS title text DEFAULT '';
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS description text DEFAULT '';
