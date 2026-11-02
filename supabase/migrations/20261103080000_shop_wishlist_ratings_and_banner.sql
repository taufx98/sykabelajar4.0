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
-- Writes go through a narrowly scoped security-definer RPC so callers cannot
-- read or forge reviewer user IDs. The function independently verifies payment.
create or replace function public.save_my_commerce_product_review(
  p_product_id uuid,
  p_rating smallint,
  p_review text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $shop$
declare
  v_user_id uuid := auth.uid();
  v_review text := pg_catalog.btrim(coalesce(p_review, ''));
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'INVALID_RATING' using errcode = '22023';
  end if;
  if pg_catalog.char_length(v_review) > 1200 then
    raise exception 'REVIEW_TOO_LONG' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_ref = p_product_id::text
      and o.user_id = v_user_id
      and o.status::text in ('PAID', 'COMPLETED')
  ) then
    raise exception 'VERIFIED_PURCHASE_REQUIRED' using errcode = '42501';
  end if;

  insert into public.commerce_product_reviews (
    product_id, user_id, rating, review, updated_at
  )
  values (
    p_product_id, v_user_id, p_rating, v_review, pg_catalog.now()
  )
  on conflict (user_id, product_id) do update
    set rating = excluded.rating,
        review = excluded.review,
        updated_at = pg_catalog.now();
end;
$shop$;

revoke all on function public.save_my_commerce_product_review(uuid, smallint, text) from public, anon;
grant execute on function public.save_my_commerce_product_review(uuid, smallint, text) to authenticated;
grant select on public.commerce_product_wishlist_counts to authenticated;
grant select on public.commerce_product_review_summaries to anon, authenticated;


-- Expose only aggregate sold quantities for active Shop products. The
-- security-definer function never returns order IDs or buyer information.
create or replace function public.list_public_commerce_product_sales_counts()
returns table (product_id uuid, sales_count bigint)
language sql
stable
security definer
set search_path = ''
as $shop$
  select
    p.id as product_id,
    coalesce(sum(oi.quantity), 0)::bigint as sales_count
  from public.commerce_products p
  join public.order_items oi
    on oi.product_ref = p.id::text
    and oi.product_type::text = p.product_type::text
  join public.orders o
    on o.id = oi.order_id
  where p.is_active = true
    and o.status::text in ('PAID', 'COMPLETED')
  group by p.id;
$shop$;

revoke all on function public.list_public_commerce_product_sales_counts() from public, anon;
grant execute on function public.list_public_commerce_product_sales_counts() to anon, authenticated;

comment on table public.commerce_product_wishlist is
  'Per-user persistent wishlist for active SYKABELAJAR Shop products; rows are protected by RLS.';
comment on table public.commerce_product_reviews is
  'Public Shop product ratings and reviews; writes require a paid/completed matching order.';
