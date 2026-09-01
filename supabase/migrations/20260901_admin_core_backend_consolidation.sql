create or replace function public.admin_save_competition(p_competition_id uuid,p_title text,p_slug text,p_short_description text default null,p_description text default null,p_category text default 'Kompetisi',p_poster_url text default null,p_visibility text default 'PUBLIC',p_status public.competition_status default 'DRAFT',p_registration_starts_at timestamptz default null,p_registration_ends_at timestamptz default null,p_starts_at timestamptz default null,p_ends_at timestamptz default null,p_juknis_url text default null,p_kisi_kisi_published boolean default false,p_kisi_kisi_content text default null) returns public.competitions language plpgsql security definer set search_path = public, private as $$
declare v_before public.competitions; v_after public.competitions;
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'TITLE_REQUIRED'; end if;
  if nullif(trim(coalesce(p_slug,'')),'') is null then raise exception 'SLUG_REQUIRED'; end if;
  if p_competition_id is null then
    insert into public.competitions(title,slug,short_description,description,category,poster_url,visibility,status,registration_starts_at,registration_ends_at,starts_at,ends_at,juknis_url,kisi_kisi_published,kisi_kisi_content)
    values(trim(p_title),trim(p_slug),p_short_description,p_description,coalesce(nullif(trim(p_category),''),'Kompetisi'),p_poster_url,coalesce(nullif(trim(p_visibility),''),'PUBLIC'),p_status,p_registration_starts_at,p_registration_ends_at,p_starts_at,p_ends_at,p_juknis_url,coalesce(p_kisi_kisi_published,false),p_kisi_kisi_content) returning * into v_after;
    perform private.write_audit('admin.competition_create','competition',v_after.id::text,'Admin panel',null,to_jsonb(v_after),null);
  else
    select * into v_before from public.competitions where id=p_competition_id for update;
    if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
    update public.competitions set title=trim(p_title),slug=trim(p_slug),short_description=p_short_description,description=p_description,category=coalesce(nullif(trim(p_category),''),'Kompetisi'),poster_url=p_poster_url,visibility=coalesce(nullif(trim(p_visibility),''),'PUBLIC'),registration_starts_at=p_registration_starts_at,registration_ends_at=p_registration_ends_at,starts_at=p_starts_at,ends_at=p_ends_at,juknis_url=p_juknis_url,kisi_kisi_published=coalesce(p_kisi_kisi_published,false),kisi_kisi_content=p_kisi_kisi_content,updated_at=now() where id=p_competition_id returning * into v_after;
    perform private.write_audit('admin.competition_update','competition',v_after.id::text,'Admin panel',to_jsonb(v_before),to_jsonb(v_after),null);
  end if; return v_after;
end; $$;

create or replace function public.admin_delete_competition(p_competition_id uuid,p_reason text default 'Admin panel') returns public.competitions language plpgsql security definer set search_path = public, private as $$
declare v_before public.competitions;
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  select * into v_before from public.competitions where id=p_competition_id for update; if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  delete from public.competitions where id=p_competition_id; perform private.write_audit('admin.competition_delete','competition',p_competition_id::text,p_reason,to_jsonb(v_before),null,null); return v_before;
end; $$;

create or replace function public.admin_save_post(p_post_id uuid,p_title text,p_body text,p_cover_url text default null,p_competition_id uuid default null,p_status text default 'PUBLISHED') returns public.posts language plpgsql security definer set search_path = public, private as $$
declare v_before public.posts; v_after public.posts;
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'TITLE_REQUIRED'; end if;
  if nullif(trim(coalesce(p_body,'')),'') is null then raise exception 'BODY_REQUIRED'; end if;
  if p_post_id is null then
    insert into public.posts(author_user_id,competition_id,title,body,cover_url,status) values(auth.uid(),p_competition_id,trim(p_title),p_body,p_cover_url,coalesce(nullif(trim(p_status),''),'PUBLISHED')) returning * into v_after;
    perform private.write_audit('admin.post_create','post',v_after.id::text,'Admin panel',null,to_jsonb(v_after),null);
  else
    select * into v_before from public.posts where id=p_post_id for update; if not found then raise exception 'POST_NOT_FOUND'; end if;
    update public.posts set competition_id=p_competition_id,title=trim(p_title),body=p_body,cover_url=p_cover_url,status=coalesce(nullif(trim(p_status),''),'PUBLISHED'),updated_at=now() where id=p_post_id returning * into v_after;
    perform private.write_audit('admin.post_update','post',v_after.id::text,'Admin panel',to_jsonb(v_before),to_jsonb(v_after),null);
  end if; return v_after;
end; $$;

create or replace function public.admin_delete_post(p_post_id uuid,p_reason text default 'Admin panel') returns public.posts language plpgsql security definer set search_path = public, private as $$
declare v_before public.posts;
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  select * into v_before from public.posts where id=p_post_id for update; if not found then raise exception 'POST_NOT_FOUND'; end if;
  delete from public.posts where id=p_post_id; perform private.write_audit('admin.post_delete','post',p_post_id::text,p_reason,to_jsonb(v_before),null,null); return v_before;
end; $$;

create or replace function public.admin_save_product(p_product_id uuid,p_code text,p_slug text,p_name text,p_short_description text default null,p_description text default null,p_product_type text default 'DIGITAL_ITEM',p_audiences text[] default array['student']::text[],p_price numeric default 0,p_currency text default 'IDR',p_image_url text default null,p_is_active boolean default false,p_is_featured boolean default false,p_sort_order integer default 0,p_metadata jsonb default '{}'::jsonb) returns public.commerce_products language plpgsql security definer set search_path = public, private as $$
declare v_before public.commerce_products; v_after public.commerce_products;
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'NAME_REQUIRED'; end if;
  if nullif(trim(coalesce(p_code,'')),'') is null then raise exception 'CODE_REQUIRED'; end if;
  if nullif(trim(coalesce(p_slug,'')),'') is null then raise exception 'SLUG_REQUIRED'; end if;
  if p_product_id is null then
    insert into public.commerce_products(code,slug,name,short_description,description,product_type,audiences,price,currency,image_url,is_active,is_featured,sort_order,metadata) values(trim(p_code),trim(p_slug),trim(p_name),p_short_description,p_description,coalesce(nullif(trim(p_product_type),''),'DIGITAL_ITEM'),coalesce(p_audiences,array['student']::text[]),greatest(coalesce(p_price,0),0),coalesce(nullif(trim(p_currency),''),'IDR'),p_image_url,coalesce(p_is_active,false),coalesce(p_is_featured,false),coalesce(p_sort_order,0),coalesce(p_metadata,'{}'::jsonb)) returning * into v_after;
    perform private.write_audit('admin.product_create','commerce_product',v_after.id::text,'Admin panel',null,to_jsonb(v_after),null);
  else
    select * into v_before from public.commerce_products where id=p_product_id for update; if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    update public.commerce_products set code=trim(p_code),slug=trim(p_slug),name=trim(p_name),short_description=p_short_description,description=p_description,product_type=coalesce(nullif(trim(p_product_type),''),'DIGITAL_ITEM'),audiences=coalesce(p_audiences,array['student']::text[]),price=greatest(coalesce(p_price,0),0),currency=coalesce(nullif(trim(p_currency),''),'IDR'),image_url=p_image_url,is_active=coalesce(p_is_active,false),is_featured=coalesce(p_is_featured,false),sort_order=coalesce(p_sort_order,0),metadata=coalesce(p_metadata,'{}'::jsonb),updated_at=now() where id=p_product_id returning * into v_after;
    perform private.write_audit('admin.product_update','commerce_product',v_after.id::text,'Admin panel',to_jsonb(v_before),to_jsonb(v_after),null);
  end if; return v_after;
end; $$;

create or replace function public.admin_delete_product(p_product_id uuid,p_reason text default 'Admin panel') returns public.commerce_products language plpgsql security definer set search_path = public, private as $$
declare v_before public.commerce_products;
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  select * into v_before from public.commerce_products where id=p_product_id for update; if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  delete from public.commerce_products where id=p_product_id; perform private.write_audit('admin.product_delete','commerce_product',p_product_id::text,p_reason,to_jsonb(v_before),null,null); return v_before;
end; $$;

revoke all on function public.admin_save_competition(uuid,text,text,text,text,text,text,text,public.competition_status,timestamptz,timestamptz,timestamptz,timestamptz,text,boolean,text) from public;
revoke all on function public.admin_delete_competition(uuid,text) from public;
revoke all on function public.admin_save_post(uuid,text,text,text,uuid,text) from public;
revoke all on function public.admin_delete_post(uuid,text) from public;
revoke all on function public.admin_save_product(uuid,text,text,text,text,text,text,text[],numeric,text,text,boolean,boolean,integer,jsonb) from public;
revoke all on function public.admin_delete_product(uuid,text) from public;
grant execute on function public.admin_save_competition(uuid,text,text,text,text,text,text,text,public.competition_status,timestamptz,timestamptz,timestamptz,timestamptz,text,boolean,text) to authenticated;
grant execute on function public.admin_delete_competition(uuid,text) to authenticated;
grant execute on function public.admin_save_post(uuid,text,text,text,uuid,text) to authenticated;
grant execute on function public.admin_delete_post(uuid,text) to authenticated;
grant execute on function public.admin_save_product(uuid,text,text,text,text,text,text,text[],numeric,text,text,boolean,boolean,integer,jsonb) to authenticated;
grant execute on function public.admin_delete_product(uuid,text) to authenticated;
