-- ============================================================
-- Messaging Rules: Privacy, Follow Approval, Ticket System
-- ============================================================

-- 1. Privacy settings on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS accept_messages text NOT NULL DEFAULT 'public';
-- Values: 'public' (anyone can DM), 'followers' (only followers), 'private' (nobody)

-- 2. Follow approval system
ALTER TABLE follows ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'auto';
-- Values: 'auto' (public profile, auto-approved), 'pending' (waiting approval), 'approved'

-- 3. Thread type on chat_threads (ticket vs dm)
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS thread_type text NOT NULL DEFAULT 'dm';
-- Values: 'dm' (direct message), 'ticket' (helpdesk)
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS description text;

-- Index
CREATE INDEX IF NOT EXISTS idx_follows_status ON follows(following_id, status);
