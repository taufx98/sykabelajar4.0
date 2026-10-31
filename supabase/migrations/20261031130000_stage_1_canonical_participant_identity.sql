begin;

-- Stage 1: one canonical participant identity per competition and real participant.
-- Individual users keep their normal account; collective participants keep their
-- existing portal/code access. Only the data identity, result and ranking contract
-- is unified here.

-- Make the identity kind agree with the populated identity key.
alter table public.participants
  add constraint participants_identity_kind_check
  check (
    (participant_type = 'INDIVIDUAL' and user_id is not null and collective_participant_id is null)
    or
    (participant_type = 'COLLECTIVE' and collective_participant_id is not null and user_id is null)
  ) not valid;

alter table public.participants
  validate constraint participants_identity_kind_check;

-- The registration sync trigger uses this exact partial-conflict target.
create unique index if not exists participants_individual_competition_user_uidx
  on public.participants (competition_id, user_id)
  where participant_type = 'INDIVIDUAL' and user_id is not null;

-- Backfill individual identities from active registrations and any legacy
-- non-preview attempt/certificate records. DISTINCT identities prevent duplicate
-- rows when one person has several legacy records in the same competition.
with individual_identities as (
  select r.competition_id, r.user_id
  from public.registrations r
  where r.user_id is not null
    and r.status::text in ('APPROVED', 'ACTIVE')

  union

  select a.competition_id, a.participant_id
  from public.attempts a
  where a.is_preview = false
    and a.participant_id is not null

  union

  select cert.competition_id, cert.user_id
  from public.certificates cert
  where cert.competition_id is not null
    and cert.user_id is not null
),
individual_rows as (
  select
    i.competition_id,
    i.user_id,
    p.full_name,
    p.username,
    p.grade,
    p.school_id,
    p.avatar_url,
    r.id as registration_id
  from individual_identities i
  join public.profiles p on p.id = i.user_id
  left join lateral (
    select r1.id
    from public.registrations r1
    where r1.competition_id = i.competition_id
      and r1.user_id = i.user_id
      and r1.status::text in ('APPROVED', 'ACTIVE')
    order by
      (r1.status::text = 'ACTIVE') desc,
      coalesce(r1.approved_at, r1.submitted_at, r1.created_at) desc,
      r1.created_at desc,
      r1.id desc
    limit 1
  ) r on true
)
insert into public.participants (
  competition_id,
  registration_id,
  user_id,
  participant_type,
  full_name,
  grade,
  school_id,
  photo_url
)
select
  competition_id,
  registration_id,
  user_id,
  'INDIVIDUAL',
  coalesce(nullif(full_name, ''), nullif(username, ''), 'Participant'),
  grade,
  school_id,
  avatar_url
from individual_rows
on conflict (competition_id, user_id)
  where participant_type = 'INDIVIDUAL' and user_id is not null
do update set
  registration_id = coalesce(excluded.registration_id, public.participants.registration_id),
  full_name = case
    when excluded.full_name <> 'Participant' then excluded.full_name
    else public.participants.full_name
  end,
  grade = coalesce(excluded.grade, public.participants.grade),
  school_id = coalesce(excluded.school_id, public.participants.school_id),
  photo_url = coalesce(excluded.photo_url, public.participants.photo_url),
  updated_at = now();

-- Backfill collective participants that are active or already have historical
-- attempts/certificates. A claimed participant remains a collective identity;
-- claim ownership is represented by collective_participants.user_id.
insert into public.participants (
  competition_id,
  registration_id,
  collective_participant_id,
  participant_type,
  participant_code,
  full_name,
  class_name,
  grade,
  school_id,
  photo_url
)
select
  cp.competition_id,
  cp.registration_id,
  cp.id,
  'COLLECTIVE',
  cp.participant_code,
  cp.full_name,
  cp.class_name,
  cp.grade,
  cp.school_id,
  cp.photo_url
from public.collective_participants cp
where cp.status::text = 'ACTIVE'
   or exists (
     select 1
     from public.attempts a
     where a.collective_participant_id = cp.id
       and a.is_preview = false
   )
   or exists (
     select 1
     from public.collective_certificates cc
     where cc.collective_participant_id = cp.id
   )
on conflict (competition_id, collective_participant_id)
  where collective_participant_id is not null
do update set
  registration_id = coalesce(excluded.registration_id, public.participants.registration_id),
  participant_code = excluded.participant_code,
  full_name = excluded.full_name,
  class_name = excluded.class_name,
  grade = excluded.grade,
  school_id = excluded.school_id,
  photo_url = excluded.photo_url,
  updated_at = now();

-- Link all historical official records after both identity types exist.
-- Preview attempts deliberately remain detached from real participants.
update public.attempts a
set canonical_participant_id = p.id
from public.participants p
where a.canonical_participant_id is null
  and a.is_preview = false
  and a.participant_id is not null
  and p.competition_id = a.competition_id
  and p.user_id = a.participant_id
  and p.participant_type = 'INDIVIDUAL';

update public.attempts a
set canonical_participant_id = p.id
from public.participants p
where a.canonical_participant_id is null
  and a.is_preview = false
  and a.collective_participant_id is not null
  and p.competition_id = a.competition_id
  and p.collective_participant_id = a.collective_participant_id
  and p.participant_type = 'COLLECTIVE';

update public.certificates cert
set canonical_participant_id = p.id
from public.participants p
where cert.canonical_participant_id is null
  and cert.competition_id = p.competition_id
  and cert.user_id = p.user_id
  and p.participant_type = 'INDIVIDUAL';

update public.collective_certificates cc
set canonical_participant_id = p.id
from public.participants p
where cc.canonical_participant_id is null
  and cc.competition_id = p.competition_id
  and cc.collective_participant_id = p.collective_participant_id
  and p.participant_type = 'COLLECTIVE';

-- Keep collective identities in sync from the moment an active participant is
-- provisioned, not only when the participant starts an exam or receives a cert.
create or replace function private.sync_collective_participant_to_canonical_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status::text = 'ACTIVE' then
    perform private.ensure_canonical_participant_for_collective(new.id);
  else
    update public.participants p
    set
      registration_id = coalesce(new.registration_id, p.registration_id),
      participant_code = new.participant_code,
      full_name = new.full_name,
      class_name = new.class_name,
      grade = new.grade,
      school_id = new.school_id,
      photo_url = new.photo_url,
      updated_at = now()
    where p.competition_id = new.competition_id
      and p.collective_participant_id = new.id;
  end if;

  return new;
end;
$function$;

revoke all on function private.sync_collective_participant_to_canonical_participant()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_collective_participant_canonical on public.collective_participants;
create trigger trg_collective_participant_canonical
after insert or update of
  status,
  registration_id,
  participant_code,
  full_name,
  class_name,
  grade,
  school_id,
  photo_url
on public.collective_participants
for each row
execute function private.sync_collective_participant_to_canonical_participant();

-- One rank source for individual users, collective portal users and claimed
-- collective history. A participant contributes only its latest finalized,
-- non-preview attempt; ties share a rank (competition ranking: 1, 2, 2, 4).
create or replace function private.canonical_competition_rank(
  p_competition_id uuid,
  p_canonical_participant_id uuid
)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $function$
  with latest_finalized as (
    select distinct on (a.canonical_participant_id)
      a.canonical_participant_id,
      a.score
    from public.attempts a
    where a.competition_id = p_competition_id
      and a.status = 'FINALIZED'
      and a.is_preview = false
      and a.canonical_participant_id is not null
    order by
      a.canonical_participant_id,
      a.finalized_at desc nulls last,
      a.created_at desc,
      a.id desc
  ),
  ranked as (
    select
      lf.canonical_participant_id,
      rank() over (order by lf.score desc nulls last) as rank_position
    from latest_finalized lf
  )
  select r.rank_position
  from ranked r
  where r.canonical_participant_id = p_canonical_participant_id;
$function$;

revoke all on function private.canonical_competition_rank(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Canonical individual/collective result endpoint now uses one latest attempt
-- per canonical participant when calculating a rank. Claimed collective
-- participants may also view their own result.
create or replace function public.get_canonical_competition_result(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  p public.participants%rowtype;
  a public.attempts%rowtype;
  c public.competitions%rowtype;
  v_rank bigint;
begin
  select * into p
  from public.participants
  where id = p_participant_id;

  if not found then
    raise exception 'PARTICIPANT_NOT_FOUND';
  end if;

  if not private.current_user_is_admin()
     and (p.user_id is null or p.user_id <> auth.uid())
     and not exists (
       select 1
       from public.collective_participants cp
       where cp.id = p.collective_participant_id
         and (cp.managed_by_user_id = auth.uid() or cp.user_id = auth.uid())
     ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into c
  from public.competitions
  where id = p.competition_id;

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if not private.current_user_is_admin()
     and c.status::text not in ('RESULT_PUBLISHED', 'ARCHIVED') then
    return jsonb_build_object(
      'participant_id', p.id,
      'competition_id', p.competition_id,
      'participant_type', p.participant_type,
      'name', p.full_name,
      'attempt', null,
      'rank', null,
      'published', false
    );
  end if;

  select * into a
  from public.attempts
  where canonical_participant_id = p.id
    and status = 'FINALIZED'
    and is_preview = false
  order by finalized_at desc nulls last, created_at desc, id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'participant_id', p.id,
      'competition_id', p.competition_id,
      'participant_type', p.participant_type,
      'name', p.full_name,
      'attempt', null,
      'rank', null,
      'published', true
    );
  end if;

  v_rank := private.canonical_competition_rank(p.competition_id, p.id);

  return jsonb_build_object(
    'participant_id', p.id,
    'competition_id', p.competition_id,
    'participant_type', p.participant_type,
    'name', p.full_name,
    'attempt', jsonb_build_object(
      'id', a.id,
      'status', a.status,
      'score', a.score,
      'finalized_at', a.finalized_at
    ),
    'rank', v_rank,
    'published', true
  );
end;
$function$;

revoke all on function public.get_canonical_competition_result(uuid)
  from public, anon, authenticated;
grant execute on function public.get_canonical_competition_result(uuid)
  to authenticated;

-- Preserve the collective token portal contract. Its score/rank now comes from
-- the same canonical attempt/ranking source as individual participants.
create or replace function public.get_collective_participant_result(p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_collective_id uuid := private.collective_session_participant(p_access_token);
  v_cp public.collective_participants%rowtype;
  v_competition public.competitions%rowtype;
  v_canonical_participant_id uuid;
  v_attempt public.attempts%rowtype;
  v_rank bigint;
begin
  if v_collective_id is null then
    raise exception 'COLLECTIVE_SESSION_INVALID';
  end if;

  select * into v_cp
  from public.collective_participants
  where id = v_collective_id;

  if not found then
    raise exception 'COLLECTIVE_SESSION_INVALID';
  end if;

  select p.id into v_canonical_participant_id
  from public.participants p
  where p.competition_id = v_cp.competition_id
    and p.collective_participant_id = v_cp.id
    and p.participant_type = 'COLLECTIVE'
  limit 1;

  if v_canonical_participant_id is null and v_cp.status::text = 'ACTIVE' then
    perform private.ensure_canonical_participant_for_collective(v_cp.id);

    select p.id into v_canonical_participant_id
    from public.participants p
    where p.competition_id = v_cp.competition_id
      and p.collective_participant_id = v_cp.id
      and p.participant_type = 'COLLECTIVE'
    limit 1;
  end if;

  select * into v_competition
  from public.competitions
  where id = v_cp.competition_id;

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if v_canonical_participant_id is null then
    return jsonb_build_object(
      'ok', true,
      'has_result', false,
      'competition_id', v_competition.id,
      'competition_title', v_competition.title
    );
  end if;

  select * into v_attempt
  from public.attempts a
  where a.canonical_participant_id = v_canonical_participant_id
    and a.is_preview = false
    and a.status::text in ('FINALIZED', 'GRADING', 'SUBMITTED', 'EXPIRED')
  order by a.created_at desc, a.attempt_number desc, a.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'has_result', false,
      'competition_id', v_competition.id,
      'competition_title', v_competition.title
    );
  end if;

  if v_attempt.status::text <> 'FINALIZED'
     or v_competition.status::text not in ('RESULT_PUBLISHED', 'ARCHIVED') then
    return jsonb_build_object(
      'ok', true,
      'has_result', true,
      'published', false,
      'competition_id', v_competition.id,
      'competition_title', v_competition.title,
      'status', v_attempt.status
    );
  end if;

  v_rank := private.canonical_competition_rank(
    v_competition.id,
    v_canonical_participant_id
  );

  return jsonb_build_object(
    'ok', true,
    'has_result', true,
    'published', true,
    'competition_id', v_competition.id,
    'competition_title', v_competition.title,
    'score', v_attempt.score,
    'rank', v_rank,
    'attempt_id', v_attempt.id,
    'canonical_participant_id', v_canonical_participant_id
  );
end;
$function$;

revoke all on function public.get_collective_participant_result(text)
  from public;
revoke all on function public.get_collective_participant_result(text)
  from anon, authenticated;
grant execute on function public.get_collective_participant_result(text)
  to anon, authenticated, service_role;

-- The claimed-history page is part of the same canonical result contract. It
-- must not expose a score before publication and must use the shared rank.
create or replace function public.list_my_claimed_collective_history()
returns table (
  participant_id uuid,
  competition_id uuid,
  competition_title text,
  participant_code text,
  full_name text,
  attempt_status text,
  score numeric,
  rank bigint,
  result_published boolean,
  certificate_status text,
  serial_number text,
  verification_code text,
  certificate_url text,
  issued_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  return query
  select
    cp.id,
    cp.competition_id,
    c.title,
    cp.participant_code,
    cp.full_name,
    a.status::text,
    case
      when a.status::text = 'FINALIZED'
       and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
      then a.score
      else null::numeric
    end,
    case
      when a.status::text = 'FINALIZED'
       and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
       and p.id is not null
      then private.canonical_competition_rank(cp.competition_id, p.id)
      else null::bigint
    end,
    (
      a.status::text = 'FINALIZED'
      and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
    ),
    cc.status,
    cc.serial_number,
    cc.verification_code,
    cc.certificate_url,
    cc.issued_at
  from public.collective_participants cp
  join public.competitions c on c.id = cp.competition_id
  left join public.participants p
    on p.competition_id = cp.competition_id
   and p.collective_participant_id = cp.id
   and p.participant_type = 'COLLECTIVE'
  left join lateral (
    select a1.status, a1.score
    from public.attempts a1
    where a1.canonical_participant_id = p.id
      and a1.is_preview = false
    order by a1.created_at desc, a1.attempt_number desc, a1.id desc
    limit 1
  ) a on true
  left join public.collective_certificates cc
    on cc.collective_participant_id = cp.id
  where cp.user_id = auth.uid()
  order by c.title, cp.full_name;
end;
$function$;

revoke all on function public.list_my_claimed_collective_history()
  from public, anon, authenticated;
grant execute on function public.list_my_claimed_collective_history()
  to authenticated, service_role;

-- Make claimed collective certificates visible through the same canonical
-- certificate history API, while still restricting each row to its owner.
create or replace function public.list_my_canonical_certificates()
returns table (
  participant_id uuid,
  competition_id uuid,
  participant_type text,
  user_id uuid,
  collective_participant_id uuid,
  full_name text,
  certificate_id uuid,
  certificate_type text,
  status text,
  serial_number text,
  certificate_url text,
  certificate_public_id text,
  issued_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  select
    pc.participant_id,
    pc.competition_id,
    pc.participant_type,
    pc.user_id,
    pc.collective_participant_id,
    pc.full_name,
    pc.certificate_id,
    pc.certificate_type,
    pc.status,
    pc.serial_number,
    pc.certificate_url,
    pc.certificate_public_id,
    pc.issued_at
  from public.participant_certificates pc
  where pc.user_id = auth.uid()
     or (
       pc.collective_participant_id is not null
       and exists (
         select 1
         from public.collective_participants cp
         where cp.id = pc.collective_participant_id
           and cp.user_id = auth.uid()
       )
     )
  order by pc.issued_at desc nulls last;
$function$;

revoke all on function public.list_my_canonical_certificates()
  from public, anon, authenticated;
grant execute on function public.list_my_canonical_certificates()
  to authenticated, service_role;

-- Protect the future Lomba Saya contract: attempt scores are hidden until the
-- competition's result is public, matching get_canonical_competition_result().
create or replace function public.list_my_participant_core()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      jsonb_build_object(
        'participant', to_jsonb(p),
        'competition', jsonb_build_object(
          'id', c.id,
          'slug', c.slug,
          'title', c.title,
          'status', c.status,
          'poster_url', c.poster_url
        ),
        'registration', jsonb_build_object(
          'id', r.id,
          'status', r.status,
          'submitted_at', r.submitted_at,
          'approved_at', r.approved_at,
          'rejected_at', r.rejected_at
        ),
        'latest_attempt', case
          when a.id is null then null
          else jsonb_build_object(
            'id', a.id,
            'status', a.status,
            'attempt_number', a.attempt_number,
            'started_at', a.started_at,
            'expires_at', a.expires_at,
            'submitted_at', a.submitted_at,
            'finalized_at', a.finalized_at,
            'score', case
              when c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED') then a.score
              else null
            end
          )
        end,
        'certificate_count', (
          select count(*)
          from public.certificates cert
          where cert.canonical_participant_id = p.id
        )
      ) as row_data,
      c.created_at
    from public.participants p
    join public.competitions c on c.id = p.competition_id
    left join public.registrations r on r.id = p.registration_id
    left join lateral (
      select a1.*
      from public.attempts a1
      where a1.canonical_participant_id = p.id
        and a1.is_preview = false
      order by a1.attempt_number desc, a1.created_at desc, a1.id desc
      limit 1
    ) a on true
    where p.user_id = v_uid
      and p.participant_type = 'INDIVIDUAL'
  ) s;

  return v_result;
end;
$function$;

revoke all on function public.list_my_participant_core()
  from public, anon, authenticated;
grant execute on function public.list_my_participant_core()
  to authenticated, service_role;

-- The migration must leave all official records linked. These assertions are
-- fail-closed so deployment cannot silently leave only part of the backfill.
do $verify$
begin
  if exists (
    select 1
    from public.registrations r
    join public.profiles profile on profile.id = r.user_id
    where r.status::text in ('APPROVED', 'ACTIVE')
      and not exists (
        select 1
        from public.participants p
        where p.competition_id = r.competition_id
          and p.user_id = r.user_id
          and p.participant_type = 'INDIVIDUAL'
      )
  ) then
    raise exception 'CANONICAL_BACKFILL_INCOMPLETE: approved or active individual registration';
  end if;

  if exists (
    select 1
    from public.collective_participants cp
    where (
         cp.status::text = 'ACTIVE'
         or exists (
           select 1 from public.attempts a
           where a.collective_participant_id = cp.id and a.is_preview = false
         )
         or exists (
           select 1 from public.collective_certificates cc
           where cc.collective_participant_id = cp.id
         )
       )
      and not exists (
        select 1
        from public.participants p
        where p.competition_id = cp.competition_id
          and p.collective_participant_id = cp.id
          and p.participant_type = 'COLLECTIVE'
      )
  ) then
    raise exception 'CANONICAL_BACKFILL_INCOMPLETE: collective participant';
  end if;

  if exists (
    select 1
    from public.attempts a
    where a.is_preview = false
      and a.canonical_participant_id is null
      and (a.participant_id is not null or a.collective_participant_id is not null)
  ) then
    raise exception 'CANONICAL_BACKFILL_INCOMPLETE: official attempt';
  end if;

  if exists (
    select 1
    from public.certificates cert
    where cert.competition_id is not null
      and cert.canonical_participant_id is null
  ) then
    raise exception 'CANONICAL_BACKFILL_INCOMPLETE: individual certificate';
  end if;

  if exists (
    select 1
    from public.collective_certificates cc
    where cc.canonical_participant_id is null
  ) then
    raise exception 'CANONICAL_BACKFILL_INCOMPLETE: collective certificate';
  end if;
end;
$verify$;

commit;
