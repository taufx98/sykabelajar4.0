create or replace function private.guard_organizer_member_governance()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_owner uuid;
  v_user_is_owner boolean;
begin
  if private.current_user_is_admin() then
    return coalesce(new, old);
  end if;

  select owner_user_id into v_owner
  from public.organizers
  where id = coalesce(new.organizer_id, old.organizer_id);
  v_user_is_owner := auth.uid() is not null and auth.uid() = v_owner;

  if tg_op = 'INSERT' then
    if new.user_id is null or new.organizer_id is null then raise exception 'INVALID_MEMBER'; end if;
    new.member_role := lower(coalesce(nullif(new.member_role,''), new.role, 'viewer'));
    new.role := lower(coalesce(nullif(new.role,''), new.member_role, 'viewer'));
    if new.member_role = 'owner' or new.role = 'owner' then
      if new.user_id is distinct from v_owner or not v_user_is_owner then raise exception 'OWNER_ROLE_ADMIN_OR_OWNER_ONLY'; end if;
      new.member_role := 'owner'; new.role := 'owner';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.member_role = 'owner' or old.role = 'owner' then
      if new.user_id is distinct from old.user_id
         or new.organizer_id is distinct from old.organizer_id
         or lower(coalesce(new.member_role,'')) <> 'owner'
         or lower(coalesce(new.role,'')) <> 'owner' then
        raise exception 'OWNER_MEMBERSHIP_PROTECTED';
      end if;
      if old.role = 'owner' and not v_user_is_owner then raise exception 'OWNER_MEMBERSHIP_PROTECTED'; end if;
      new.member_role := 'owner'; new.role := 'owner';
      return new;
    end if;
    if lower(coalesce(new.member_role,'')) = 'owner' or lower(coalesce(new.role,'')) = 'owner' then
      if new.user_id is distinct from v_owner or not v_user_is_owner then raise exception 'OWNER_ROLE_ADMIN_OR_OWNER_ONLY'; end if;
      new.member_role := 'owner'; new.role := 'owner';
      return new;
    end if;
    new.member_role := lower(coalesce(nullif(new.member_role,''), new.role, old.member_role));
    new.role := lower(coalesce(nullif(new.role,''), new.member_role, old.role));
    return new;
  end if;

  if tg_op = 'DELETE' and (old.member_role='owner' or old.role='owner') then raise exception 'OWNER_MEMBERSHIP_PROTECTED'; end if;
  return old;
end;
$$;

create or replace function private.guard_organizer_owner_transfer()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.owner_user_id is distinct from new.owner_user_id and not private.current_user_is_admin() then
    raise exception 'OWNER_TRANSFER_ADMIN_ONLY';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_organizers_owner_transfer on public.organizers;
create trigger trg_organizers_owner_transfer
before update of owner_user_id on public.organizers
for each row execute function private.guard_organizer_owner_transfer();

create unique index if not exists organizers_one_owner_per_user_idx on public.organizers(owner_user_id);

alter table public.organizer_members disable trigger trg_guard_organizer_member_governance;
update public.organizer_members om
set member_role='owner', role='owner'
where om.member_role='owner'
  and om.user_id = (select o.owner_user_id from public.organizers o where o.id=om.organizer_id)
  and om.role <> 'owner';
alter table public.organizer_members enable trigger trg_guard_organizer_member_governance;
