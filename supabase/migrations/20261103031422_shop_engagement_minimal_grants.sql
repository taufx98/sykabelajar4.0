-- Tighten Shop object grants for projects with permissive default privileges.
-- RLS remains enabled on both underlying tables; only the required Data API
-- permissions are restored after removing PUBLIC/anon/authenticated defaults.

revoke all on table public.commerce_product_wishlist
  from public, anon, authenticated;
grant select, insert, delete on table public.commerce_product_wishlist
  to authenticated;

revoke all on table public.commerce_product_reviews
  from public, anon, authenticated;
grant select (id, product_id, rating, review, created_at)
  on table public.commerce_product_reviews
  to anon, authenticated;

revoke all on table public.commerce_product_wishlist_counts
  from public, anon, authenticated;
grant select on public.commerce_product_wishlist_counts
  to authenticated;

revoke all on table public.commerce_product_review_summaries
  from public, anon, authenticated;
grant select on public.commerce_product_review_summaries
  to anon, authenticated;

-- Keep writes behind the authenticated, ownership-checked RPC.
revoke all on function public.save_my_commerce_product_review(uuid, smallint, text)
  from public, anon;
grant execute on function public.save_my_commerce_product_review(uuid, smallint, text)
  to authenticated;

-- Only aggregate paid sales are exposed; no buyer or order details are returned.
revoke all on function public.list_public_commerce_product_sales_counts()
  from public;
grant execute on function public.list_public_commerce_product_sales_counts()
  to anon, authenticated;

notify pgrst, 'reload schema';
