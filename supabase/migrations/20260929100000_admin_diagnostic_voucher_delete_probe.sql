-- Read-only admin diagnostic for the organizer voucher delete failure.
-- Verifies FK dependencies and confirms the delete RPC contains the safe fallback
-- without executing any mutation.
create or replace function public.admin_diagnose_organizer_voucher_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public', 'private'
as $function$
declare
  v_uid uuid := auth.uid();
  v_voucher_exists boolean;
  v_order_reference_count bigint := 0;
  v_claim_reference_count bigint := 0;
  v_function_definition text := '';
  v_fk_delete_action text := null;
  v_fallback_detected boolean := false;
  v_soft_delete_detected boolean := false;
  v_verified_fixed boolean := false;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.current_user_is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_id is null then
    raise exception 'VOUCHER_ID_REQUIRED';
  end if;

  select exists(
    select 1
    from public.organizer_vouchers
    where id = p_id
  )
  into v_voucher_exists;

  select count(*)::bigint
  into v_order_reference_count
  from public.orders
  where voucher_id = p_id;

  select count(*)::bigint
  into v_claim_reference_count
  from public.organizer_voucher_claims
  where voucher_id = p_id;

  select pg_get_functiondef(p.oid)
  into v_function_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'admin_delete_organizer_voucher'
    and pg_get_function_identity_arguments(p.oid) = 'p_id uuid'
  order by p.oid desc
  limit 1;

  select case c.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else null
  end
  into v_fk_delete_action
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public'
    and rel.relname = 'orders'
    and c.conname = 'orders_voucher_id_fkey'
  limit 1;

  v_fallback_detected :=
    position('when foreign_key_violation' in lower(coalesce(v_function_definition, ''))) > 0;

  v_soft_delete_detected :=
    position('is_active = false' in lower(coalesce(v_function_definition, ''))) > 0
    and position('ends_at = coalesce(ends_at, now())' in lower(coalesce(v_function_definition, ''))) > 0;

  v_verified_fixed :=
    (
      v_order_reference_count = 0
      and v_voucher_exists = false
    )
    or (
      v_order_reference_count > 0
      and v_voucher_exists
      and v_fallback_detected
      and v_soft_delete_detected
    );

  return jsonb_build_object(
    'ok', true,
    'voucher_exists', v_voucher_exists,
    'order_reference_count', v_order_reference_count,
    'claim_reference_count', v_claim_reference_count,
    'foreign_key_delete_action', v_fk_delete_action,
    'delete_fallback_detected', v_fallback_detected,
    'soft_delete_detected', v_soft_delete_detected,
    'verified_fixed', v_verified_fixed,
    'verification_scope', 'read_only_schema_and_dependency_probe'
  );
end;
$function$;

revoke all on function public.admin_diagnose_organizer_voucher_delete(uuid) from public;
grant execute on function public.admin_diagnose_organizer_voucher_delete(uuid) to authenticated;
