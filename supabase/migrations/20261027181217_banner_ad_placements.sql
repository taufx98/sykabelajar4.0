-- Add a placement dimension to the existing banner/request flow.
-- Existing records are preserved and default to the current Home top placement.
BEGIN;

ALTER TABLE public.ad_banner_requests
  ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'home_top';

ALTER TABLE public.ad_banners
  ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'home_top';

UPDATE public.ad_banner_requests
SET placement = 'home_top'
WHERE placement IS NULL OR placement NOT IN ('home_top', 'home_sidebar');

UPDATE public.ad_banners
SET placement = 'home_top'
WHERE placement IS NULL OR placement NOT IN ('home_top', 'home_sidebar');

ALTER TABLE public.ad_banner_requests
  ALTER COLUMN placement SET DEFAULT 'home_top',
  ALTER COLUMN placement SET NOT NULL;

ALTER TABLE public.ad_banners
  ALTER COLUMN placement SET DEFAULT 'home_top',
  ALTER COLUMN placement SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ad_banner_requests_placement_check'
      AND conrelid = 'public.ad_banner_requests'::regclass
  ) THEN
    ALTER TABLE public.ad_banner_requests
      ADD CONSTRAINT ad_banner_requests_placement_check
      CHECK (placement IN ('home_top', 'home_sidebar'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ad_banners_placement_check'
      AND conrelid = 'public.ad_banners'::regclass
  ) THEN
    ALTER TABLE public.ad_banners
      ADD CONSTRAINT ad_banners_placement_check
      CHECK (placement IN ('home_top', 'home_sidebar'));
  END IF;
END $$;

-- Slot numbers become ordering positions within a placement, allowing the
-- top carousel and sidebar carousel to each maintain their own queue.
ALTER TABLE public.ad_banners
  DROP CONSTRAINT IF EXISTS ad_banners_slot_number_key;

DROP INDEX IF EXISTS public.ad_banners_slot_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS ad_banners_placement_slot_number_key
  ON public.ad_banners (placement, slot_number);

COMMIT;
