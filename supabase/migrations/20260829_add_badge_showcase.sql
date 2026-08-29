-- Badge showcase settings for profile
-- badge_showcase: JSON array of badge names to display (max 3)
-- badge_showcase_manual: true if user manually set badges (stops auto-update)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS badge_showcase jsonb DEFAULT '[]'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS badge_showcase_manual boolean DEFAULT false;
