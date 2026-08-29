-- Add media_type and title columns to banner tables
-- Run in Supabase SQL Editor

-- ad_banners
ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS media_type text DEFAULT 'image';
ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS title text DEFAULT '';

-- ad_banner_requests
ALTER TABLE ad_banner_requests ADD COLUMN IF NOT EXISTS media_type text DEFAULT 'image';
