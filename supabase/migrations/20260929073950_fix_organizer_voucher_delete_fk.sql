-- Preserve voucher/order history when an admin "deletes" a voucher that is already referenced.
-- Unreferenced vouchers are still hard-deleted; referenced vouchers are archived instead.

create or replace function public.admin_delete_organizer_voucher(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.current_user_is_admin() then
    raise exception 'ADMIN_ONLY';
  end if;

  if p_id is null then
    raise exception 'VOUCHER_ID_REQUIRED';
  end if;

  begin
    delete from public.organizer_vouchers
    where id = p_id;

    if not found then
      raise exception 'VOUCHER_NOT_FOUND';
    end if;

    return true;
  exception
    when foreign_key_violation then
      update public.organizer_vouchers
      set
        is_active = false,
        ends_at = coalesce(ends_at, now()),
        updated_at = now()
      where id = p_id;

      if not found then
        raise exception 'VOUCHER_NOT_FOUND';
      end if;

      return true;
  end;
end;
$function$;