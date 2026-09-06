-- Phase 13 security hardening: login-required RPCs must not be callable anonymously.
revoke execute on function public.check_registration_eligibility(uuid, text) from public;
grant execute on function public.check_registration_eligibility(uuid, text) to authenticated;
revoke execute on function public.create_follow_request(uuid) from public;
grant execute on function public.create_follow_request(uuid) to authenticated;
revoke execute on function public.remove_follow(uuid) from public;
grant execute on function public.remove_follow(uuid) to authenticated;
revoke execute on function public.respond_follow_request(uuid, boolean) from public;
grant execute on function public.respond_follow_request(uuid, boolean) to authenticated;
revoke execute on function public.create_product_order(uuid, integer) from public;
grant execute on function public.create_product_order(uuid, integer) to authenticated;
revoke execute on function public.create_product_order_with_proof(uuid, integer, text, text, text, text, integer, integer, text, text) from public;
grant execute on function public.create_product_order_with_proof(uuid, integer, text, text, text, text, integer, integer, text, text) to authenticated;
