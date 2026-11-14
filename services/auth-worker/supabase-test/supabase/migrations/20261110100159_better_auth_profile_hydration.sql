-- Minimal, production-shaped profile fields required by the Better Auth
-- frontend session hydration path. This is a synthetic/local staging fixture;
-- production schema, RLS, and account records are not altered.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS pembina text DEFAULT '',
  ADD COLUMN IF NOT EXISTS badge_showcase jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS badge_showcase_manual boolean DEFAULT false;

GRANT SELECT ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_better_auth_select_own ON public.profiles;
CREATE POLICY profiles_better_auth_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    AND (SELECT auth.jwt() ->> 'iss') = 'https://auth.sykabelajar.my.id/api/auth'
  );
