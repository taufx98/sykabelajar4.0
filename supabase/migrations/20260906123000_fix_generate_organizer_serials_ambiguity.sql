create or replace function public.generate_organizer_serials(p_organizer_id uuid, p_quantity integer)
returns table(id uuid, serial_code text, qr_payload text, status text)
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_plan text;
  v_limit numeric;
  v_used bigint;
  v_qty integer := greatest(coalesce(p_quantity, 0), 0);
  v_id uuid;
  v_serial_code text;
  v_qr_payload text;
  v_status text;
  v_org_name text;
  v_org_words text[];
  v_org_suffix text;
  v_middle text;
  v_health jsonb;
  v_health_status text;
  i integer;
  j integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not (private.current_user_is_admin() or private.current_user_can_manage_organizer(p_organizer_id)) then
    raise exception 'ACCESS_DENIED';
  end if;

  if v_qty < 1 or v_qty > 100 then
    raise exception 'INVALID_QUANTITY';
  end if;

  select gs.value into v_health
  from public.global_settings as gs
  where gs.key = '__rpc_health:generate_organizer_serials';

  v_health_status := v_health->>'status';
  if v_health_status = 'BLOCKED' then
    raise exception 'RPC_BLOCKED:generate_organizer_serials';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organizer_id::text || ':serials', 0));

  select e.plan_code into v_plan
  from private.get_effective_organizer_plan(p_organizer_id) as e;

  if v_plan is null then
    raise exception 'PLAN_EXPIRED';
  end if;

  select pe.limit_value into v_limit
  from public.plan_entitlements as pe
  where pe.plan_code = v_plan
    and pe.capability = 'certificate_serials';

  if v_limit is null or v_limit <= 0 then
    raise exception 'PLAN_ENTITLEMENT_REQUIRED';
  end if;

  select count(*) into v_used
  from public.organizer_serials as os
  where os.organizer_id = p_organizer_id
    and exists (
      select 1
      from public.organizer_plans as op
      where op.organizer_id = p_organizer_id
        and op.plan_code = v_plan
        and op.is_active = true
        and os.created_at >= op.starts_at
        and (op.ends_at is null or os.created_at < op.ends_at)
    );

  if v_used + v_qty > v_limit and not private.current_user_is_admin() then
    raise exception 'SERIAL_QUOTA_EXCEEDED';
  end if;

  select o.name into v_org_name
  from public.organizers as o
  where o.id = p_organizer_id;

  v_org_name := regexp_replace(upper(coalesce(v_org_name, '')), '[^A-Z0-9 ]', '', 'g');
  v_org_words := regexp_split_to_array(trim(regexp_replace(v_org_name, '[[:space:]]+', ' ', 'g')), ' ');
  v_org_words := array(select w from unnest(v_org_words) as words(w) where w <> '');

  if coalesce(array_length(v_org_words, 1), 0) = 0 then
    v_org_suffix := 'ORG';
  elsif array_length(v_org_words, 1) = 1 then
    v_org_suffix := substr(v_org_words[1], 1, 1);
  else
    v_org_suffix := '';
    for j in 1..array_length(v_org_words, 1) loop
      v_org_suffix := v_org_suffix || substr(v_org_words[j], 1, 1);
    end loop;
  end if;

  for i in 1..v_qty loop
    loop
      v_middle := '';
      for j in 1..13 loop
        v_middle := v_middle || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 1 + floor(random() * 36)::integer, 1);
      end loop;

      v_serial_code := 'SYKA' || v_middle || v_org_suffix;

      begin
        insert into public.organizer_serials as os (organizer_id, serial_code, qr_payload, status)
        values (p_organizer_id, v_serial_code, v_serial_code, 'AVAILABLE')
        returning os.id, os.serial_code, os.qr_payload, os.status
          into v_id, v_serial_code, v_qr_payload, v_status;
        exit;
      exception
        when unique_violation then
          null;
      end;
    end loop;

    id := v_id;
    serial_code := v_serial_code;
    qr_payload := v_qr_payload;
    status := v_status;
    return next;
  end loop;
end;
$function$;
