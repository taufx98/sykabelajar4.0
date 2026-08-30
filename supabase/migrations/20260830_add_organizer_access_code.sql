-- ============================================================
-- Add access_code column to organizers table
-- This column is referenced by AdminOrganizersPage and OrganizerPage
-- but was never created in a migration.
-- ============================================================

-- Add access_code (password for organizer login)
ALTER TABLE organizers ADD COLUMN IF NOT EXISTS access_code text NOT NULL DEFAULT '0';

COMMENT ON COLUMN organizers.access_code IS 'Password/access code for organizer members to join. Set by admin.';
