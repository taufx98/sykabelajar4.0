-- ============================================================
-- Add role column to organizer_members table
-- ============================================================

ALTER TABLE organizer_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'editor';

-- Add status column if missing (used by OrganizerMembersPage)
ALTER TABLE organizer_members ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';

-- Add updated_at if missing (used by OrganizerMembersPage)
ALTER TABLE organizer_members ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
