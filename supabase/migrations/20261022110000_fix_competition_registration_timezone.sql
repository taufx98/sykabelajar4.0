begin;

-- Keep competition registration status aligned with the configured schedule.
-- The function can only open/close registration when the stored timestamps allow it.
create or replace function public.sync_competition_registration_status(p_competition_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_comp public.competitions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_competition_id is null then
    raise exception 'COMPETITION_ID_REQUIRED';
  end if;

  select * into v_comp
  from public.competitions
  where id = p_competition_id
  for update;

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if v_comp.status = 'PUBLISHED'::public.competition_status
     and v_comp.registration_starts_at is not null
     and v_now >= v_comp.registration_starts_at then
    perform set_config('syka.allow_competition_transition', '1', true);
    update public.competitions
    set status = 'REGISTRATION_OPEN'::public.competition_status,
        updated_at = clock_timestamp()
    where id = p_competition_id
    returning * into v_comp;
  end if;

  -- If a scheduler was paused across the complete registration window,
  -- catch up through the normal registration states in this same transaction.
  if v_comp.status = 'REGISTRATION_OPEN'::public.competition_status
     and v_comp.registration_ends_at is not null
     and v_now > v_comp.registration_ends_at then
    perform set_config('syka.allow_competition_transition', '1', true);
    update public.competitions
    set status = 'REGISTRATION_CLOSED'::public.competition_status,
        updated_at = clock_timestamp()
    where id = p_competition_id
    returning * into v_comp;
  end if;

  return v_comp.status::text;
end;
$function$;

revoke all on function public.sync_competition_registration_status(uuid) from public;
grant execute on function public.sync_competition_registration_status(uuid) to anon, authenticated;

create or replace function private.sync_due_competition_registration_statuses()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_comp record;
  v_processed integer := 0;
begin
  for v_comp in
    select c.id
    from public.competitions c
    where (
      c.status = 'PUBLISHED'::public.competition_status
      and c.registration_starts_at is not null
      and c.registration_starts_at <= clock_timestamp()
    ) or (
      c.status = 'REGISTRATION_OPEN'::public.competition_status
      and c.registration_ends_at is not null
      and c.registration_ends_at < clock_timestamp()
    )
    order by c.registration_starts_at nulls last, c.id
  loop
    perform public.sync_competition_registration_status(v_comp.id);
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$function$;

revoke all on function private.sync_due_competition_registration_statuses() from public, anon, authenticated;

-- Poll once per minute, while also allowing the public detail page to sync
-- immediately when a visitor opens a competition during its registration window.
do $schedule$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname = 'syka-sync-competition-registration-status'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'syka-sync-competition-registration-status',
    '* * * * *',
    'select private.sync_due_competition_registration_statuses();'
  );
end;
$schedule$;

commit;
