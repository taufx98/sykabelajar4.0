-- Phase 1 canonical public RPC names. Production was migrated before this
-- repository record was committed; migration history remains append-only.
begin;
drop function if exists public.create_organizer_plan_order_v2(uuid, text, text, text, text, text, integer, integer, text, text, text);
drop function if exists public.get_public_competitions_v2(integer);
drop function if exists public.get_public_feed_v2(integer, timestamptz);
commit;
