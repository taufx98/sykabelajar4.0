create or replace function public.prevent_profile_account_type_client_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  -- account_type is a registration attribute mirrored by the trusted auth trigger.
  -- Authenticated clients must not be able to rewrite it through the public Data API.
  if new.account_type is distinct from old.account_type
     and current_user in ('anon', 'authenticated') then
    raise exception 'ACCOUNT_TYPE_BACKEND_MANAGED'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_profile_account_type_client_mutation() from public, anon, authenticated;

drop trigger if exists profiles_account_type_backend_guard on public.profiles;
create trigger profiles_account_type_backend_guard
before update of account_type on public.profiles
for each row
execute function public.prevent_profile_account_type_client_mutation();
