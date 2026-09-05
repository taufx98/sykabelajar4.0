-- Phase 1 canonicalization record. Production changes were applied in the same
-- phase before this repository record was committed. Migration history is append-only.
begin;
drop function if exists public.create_organizer_plan_order_v2(uuid, text, text, text, text, text, integer, integer, text, text, text);
drop function if exists public.get_public_competitions_v2(integer);
drop function if exists public.get_public_feed_v2(integer, timestamptz);
alter function public.get_home_snapshot_v1(integer) rename to get_home_snapshot;
commit;
