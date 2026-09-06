-- Phase 13 security hardening: remove unnecessary client EXECUTE privileges.
-- Trigger functions and referral verification are backend-only.
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.track_competition_status() from public, anon, authenticated;
revoke execute on function public.validate_registration_insert() from public, anon, authenticated;
revoke execute on function public.verify_pending_referrals() from public, anon, authenticated;

-- These RPCs already require auth.uid() internally; anonymous callers have no supported use.
revoke execute on function public.check_registration_eligibility(uuid, text) from anon;
revoke execute on function public.create_follow_request(uuid) from anon;
revoke execute on function public.remove_follow(uuid) from anon;
revoke execute on function public.respond_follow_request(uuid, boolean) from anon;
revoke execute on function public.create_product_order(uuid, integer) from anon;
revoke execute on function public.create_product_order_with_proof(uuid, integer, text, text, text, text, integer, integer, text, text) from anon;
