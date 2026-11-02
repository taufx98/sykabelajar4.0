-- Persistent wishlist, verified product reviews, and safe aggregate views for Shop.
-- Banner copy and image are stored in the existing platform_settings table.

create table if not exists public.commerce_product_wishlist (
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint commerce_product_wishlist_pkey primary key (product_id, user_id)
);

create index if not exists commerce_product_wishlist_user_created_idx
  on public.commerce_product_wishlist (user_id, created_at desc);

alter table public.commerce_product_wishlist enable row level security;

drop policy if exists commerce_product_wishlist_read_own_or_admin on public.commerce_product_wishlist;
create policy commerce_product_wishlist_read_own_or_admin
  on public.commerce_product_wishlist
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or private.current_user_is_admin()
  );

drop policy if exists commerce_product_wishlist_insert_own on public.commerce_product_wishlist;
create policy commerce_product_wishlist_insert_own
  on public.commerce_product_wishlist
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.commerce_products p
      where p.id = product_id
        and p.is_active = true
    )
  );

drop policy if exists commerce_product_wishlist_delete_own_or_admin on public.commerce_product_wishlist;
create policy commerce_product_wishlist_delete_own_or_admin
  on public.commerce_product_wishlist
  for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    or private.current_user_is_admin()
  );

-- Product reviews are public, but only a user with a paid/completed order
-- containing this exact product can create or update their review.
create table if not exists public.commerce_product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null,
  review text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_product_reviews_rating_check check (rating between 1 and 5),
  constraint commerce_product_reviews_review_length_check check (char_length(review) <= 1200),
  constraint commerce_product_reviews_user_product_key unique (user_id, product_id)
);

create index if not exists commerce_product_reviews_product_created_idx
  on public.commerce_product_reviews (product_id, created_at desc);

alter table public.commerce_product_reviews enable row level security;

drop policy if exists commerce_product_reviews_public_read on public.commerce_product_reviews;
create policy commerce_product_reviews_public_read
  on public.commerce_product_reviews
  for select
  to anon, authenticated
  using (true);

drop policy if exists commerce_product_reviews_verified_insert on public.commerce_product_reviews;
create policy commerce_product_reviews_verified_insert
  on public.commerce_product_reviews
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.product_ref = commerce_product_reviews.product_id::text
        and o.user_id = (select auth.uid())
        and o.status::text in ('PAID', 'COMPLETED')
    )
  );

drop policy if exists commerce_product_reviews_verified_update on public.commerce_product_reviews;
create policy commerce_product_reviews_verified_update
  on public.commerce_product_reviews
  for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.product_ref = commerce_product_reviews.product_id::text
        and o.user_id = (select auth.uid())
        and o.status::text in ('PAID', 'COMPLETED')
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.product_ref = commerce_product_reviews.product_id::text
        and o.user_id = (select auth.uid())
        and o.status::text in ('PAID', 'COMPLETED')
    )
  );

create or replace view public.commerce_product_wishlist_counts
with (security_invoker = true)
as
select product_id, count(*)::bigint as wishlist_count
from public.commerce_product_wishlist
group by product_id;

create or replace view public.commerce_product_review_summaries
with (security_invoker = true)
as
select
  product_id,
  round(avg(rating)::numeric, 2) as average_rating,
  count(*)::bigint as review_count
from public.commerce_product_reviews
group by product_id;

-- Explicit grants are required for newly created public-schema objects to be
-- available through the Supabase Data API.
grant select, insert, delete on table public.commerce_product_wishlist to authenticated;
revoke all on table public.commerce_product_reviews from anon, authenticated;
grant select (id, product_id, rating, review, created_at) on table public.commerce_product_reviews to anon, authenticated;
grant insert (product_id, user_id, rating, review) on table public.commerce_product_reviews to authenticated;
grant update (rating, review, updated_at) on table public.commerce_product_reviews to authenticated;
grant select on public.commerce_product_wishlist_counts to authenticated;
grant select on public.commerce_product_review_summaries to anon, authenticated;

comment on table public.commerce_product_wishlist is
  'Per-user persistent wishlist for active SYKABELAJAR Shop products; rows are protected by RLS.';
comment on table public.commerce_product_reviews is
  'Public Shop product ratings and reviews; writes require a paid/completed matching order.';
