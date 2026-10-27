-- Enforce Cloudinary-hosted assets for every Shop product image, including direct DB writes.
-- Images remain optional; when present, they must be canonical HTTPS Cloudinary image/upload URLs.
alter table public.commerce_products
  drop constraint if exists commerce_products_image_url_cloudinary_check;
alter table public.commerce_products
  add constraint commerce_products_image_url_cloudinary_check
  check (
    image_url is null
    or btrim(image_url) = ''
    or image_url ~* '^https://res\.cloudinary\.com/[^/]+/image/upload/[^[:space:]]+$'
  );

create or replace function public.admin_save_product(
  p_product_id uuid,
  p_code text,
  p_slug text,
  p_name text,
  p_short_description text default null,
  p_description text default null,
  p_product_type text default 'DIGITAL_ITEM',
  p_audiences text[] default array['student']::text[],
  p_price numeric default 0,
  p_currency text default 'IDR',
  p_image_url text default null,
  p_is_active boolean default false,
  p_is_featured boolean default false,
  p_sort_order integer default 0,
  p_metadata jsonb default '{}'::jsonb
) returns public.commerce_products
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_before public.commerce_products;
  v_after public.commerce_products;
  v_type text := upper(trim(coalesce(p_product_type, 'DIGITAL_ITEM')));
  v_audiences text[] := coalesce(p_audiences, array[]::text[]);
  v_price numeric := coalesce(p_price, 0);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_badge_id uuid;
  v_coin_amount integer;
  v_serial_quantity integer;
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'NAME_REQUIRED'; end if;
  if nullif(trim(coalesce(p_code,'')),'') is null then raise exception 'CODE_REQUIRED'; end if;
  if nullif(trim(coalesce(p_slug,'')),'') is null then raise exception 'SLUG_REQUIRED'; end if;
  if v_type not in ('DIGITAL_ITEM','DONATION','EDU_COIN_TOPUP','BADGE','CERTIFICATE_SERIALS','COLLECTIVE_CERTIFICATE') then
    raise exception 'PRODUCT_TYPE_NOT_SUPPORTED';
  end if;
  if cardinality(v_audiences) = 0 then raise exception 'AUDIENCE_REQUIRED'; end if;
  if not (v_audiences <@ array['student','teacher','organizer']::text[]) then raise exception 'AUDIENCE_INVALID'; end if;
  if v_price < 0 then raise exception 'PRICE_INVALID'; end if;
  if coalesce(p_is_active,false) and v_price <= 0 and v_type <> 'COLLECTIVE_CERTIFICATE' then
    raise exception 'ACTIVE_PRODUCT_PRICE_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_image_url,'')),'') is not null
     and trim(p_image_url) !~* '^https://res\.cloudinary\.com/[^/]+/image/upload/[^[:space:]]+$' then
    raise exception 'IMAGE_URL_CLOUDINARY_REQUIRED';
  end if;

  if v_type = 'EDU_COIN_TOPUP' then
    if coalesce(v_metadata->>'coin_amount','') !~ '^[0-9]+$' then raise exception 'COIN_AMOUNT_REQUIRED'; end if;
    v_coin_amount := (v_metadata->>'coin_amount')::integer;
    if v_coin_amount < 1 or v_coin_amount > 1000000 then raise exception 'COIN_AMOUNT_INVALID'; end if;
  elsif v_type = 'BADGE' then
    if coalesce(v_metadata->>'badge_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'BADGE_REQUIRED'; end if;
    v_badge_id := (v_metadata->>'badge_id')::uuid;
    if not exists(select 1 from public.badges b where b.id=v_badge_id and b.status='ACTIVE' and b.is_purchasable=true and b.award_type='MANUAL') then raise exception 'BADGE_NOT_AVAILABLE'; end if;
  elsif v_type = 'CERTIFICATE_SERIALS' then
    if coalesce(v_metadata->>'serial_quantity','') !~ '^[0-9]+$' then raise exception 'SERIAL_QUANTITY_REQUIRED'; end if;
    v_serial_quantity := (v_metadata->>'serial_quantity')::integer;
    if v_serial_quantity < 1 or v_serial_quantity > 1000 then raise exception 'SERIAL_QUANTITY_INVALID'; end if;
    if not ('organizer' = any(v_audiences)) then raise exception 'SERIALS_ORGANIZER_ONLY'; end if;
  elsif v_type = 'COLLECTIVE_CERTIFICATE' then
    if not ('teacher' = any(v_audiences)) then raise exception 'COLLECTIVE_CERTIFICATE_TEACHER_ONLY'; end if;
    -- The real fee comes from the existing certificate settings, not this product's placeholder price.
    v_price := 0;
    v_metadata := jsonb_build_object('fulfillment','COLLECTIVE_CERTIFICATE');
  end if;

  if p_product_id is null then
    insert into public.commerce_products(
      code,slug,name,short_description,description,product_type,audiences,price,currency,
      image_url,is_active,is_featured,sort_order,metadata
    ) values (
      trim(p_code),trim(p_slug),trim(p_name),
      nullif(trim(coalesce(p_short_description,'')),''),
      nullif(trim(coalesce(p_description,'')),''),
      v_type,v_audiences,v_price,coalesce(nullif(trim(p_currency),''),'IDR'),
      nullif(trim(coalesce(p_image_url,'')),''),
      coalesce(p_is_active,false),coalesce(p_is_featured,false),greatest(coalesce(p_sort_order,0),0),v_metadata
    ) returning * into v_after;
    perform private.write_audit('admin.product_create','commerce_product',v_after.id::text,'Admin Shop',null,to_jsonb(v_after),null);
  else
    select * into v_before from public.commerce_products where id=p_product_id for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    update public.commerce_products set
      code=trim(p_code),slug=trim(p_slug),name=trim(p_name),
      short_description=nullif(trim(coalesce(p_short_description,'')),''),
      description=nullif(trim(coalesce(p_description,'')),''),
      product_type=v_type,audiences=v_audiences,price=v_price,
      currency=coalesce(nullif(trim(p_currency),''),'IDR'),
      image_url=nullif(trim(coalesce(p_image_url,'')),''),
      is_active=coalesce(p_is_active,false),is_featured=coalesce(p_is_featured,false),
      sort_order=greatest(coalesce(p_sort_order,0),0),metadata=v_metadata,updated_at=now()
    where id=p_product_id returning * into v_after;
    perform private.write_audit('admin.product_update','commerce_product',v_after.id::text,'Admin Shop',to_jsonb(v_before),to_jsonb(v_after),null);
  end if;
  return v_after;
end;
$$;

revoke execute on function public.admin_save_product(uuid,text,text,text,text,text,text,text[],numeric,text,text,boolean,boolean,integer,jsonb) from public, anon;
grant execute on function public.admin_save_product(uuid,text,text,text,text,text,text,text[],numeric,text,text,boolean,boolean,integer,jsonb) to authenticated;
