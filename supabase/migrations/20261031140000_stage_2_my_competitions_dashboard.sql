begin;

-- Stage 2: provide one authenticated, server-authoritative list for the
-- participant's own competition registrations and claimed collective history.
-- This relies on the canonical participant model from Stage 1.
create or replace function public.list_my_competition_dashboard()
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

  with individual_competition_ids as (
    select r.competition_id
    from public.registrations r
    where r.user_id = v_uid

    union

    select p.competition_id
    from public.participants p
    where p.user_id = v_uid
      and p.participant_type = 'INDIVIDUAL'
  ),
  individual_rows as (
    select
      jsonb_build_object(
        'entry_id', coalesce(p.id, r.id),
        'participant_type', 'INDIVIDUAL',
        'participant', case
          when p.id is null then null
          else jsonb_build_object(
            'id', p.id,
            'full_name', p.full_name,
            'participant_type', p.participant_type,
            'participant_code', p.participant_code,
            'class_name', p.class_name,
            'grade', p.grade
          )
        end,
        'competition', jsonb_build_object(
          'id', c.id,
          'slug', c.slug,
          'title', c.title,
          'category', c.category,
          'status', c.status,
          'poster_url', c.poster_url,
          'registration_starts_at', c.registration_starts_at,
          'registration_ends_at', c.registration_ends_at,
          'starts_at', c.starts_at,
          'ends_at', c.ends_at,
          'announcement_at', c.announcement_at
        ),
        'registration', case
          when r.id is null then null
          else jsonb_build_object(
            'id', r.id,
            'status', r.status,
            'submitted_at', r.submitted_at,
            'approved_at', r.approved_at,
            'rejected_at', r.rejected_at,
            'rejection_reason', r.rejection_reason
          )
        end,
        'latest_attempt', case
          when latest_attempt.id is null then null
          else jsonb_build_object(
            'id', latest_attempt.id,
            'status', latest_attempt.status,
            'attempt_number', latest_attempt.attempt_number,
            'started_at', latest_attempt.started_at,
            'expires_at', latest_attempt.expires_at,
            'submitted_at', latest_attempt.submitted_at,
            'finalized_at', latest_attempt.finalized_at
          )
        end,
        'result', jsonb_build_object(
          'published',
            latest_finalized.id is not null
            and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED'),
          'score', case
            when latest_finalized.id is not null
             and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
            then latest_finalized.score
            else null
          end,
          'rank', case
            when latest_finalized.id is not null
             and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
             and p.id is not null
            then private.canonical_competition_rank(c.id, p.id)
            else null
          end,
          'finalized_at', latest_finalized.finalized_at
        ),
        'certificate_count', coalesce(certs.certificate_count, 0),
        'published_certificate_count', coalesce(certs.published_certificate_count, 0)
      ) as item,
      greatest(
        coalesce(latest_attempt.updated_at, latest_attempt.created_at),
        r.updated_at,
        p.updated_at,
        c.created_at
      ) as activity_at
    from individual_competition_ids ids
    join public.competitions c on c.id = ids.competition_id
    left join public.participants p
      on p.competition_id = c.id
     and p.user_id = v_uid
     and p.participant_type = 'INDIVIDUAL'
    left join lateral (
      select r1.*
      from public.registrations r1
      where r1.competition_id = c.id
        and r1.user_id = v_uid
      order by r1.created_at desc, r1.updated_at desc, r1.id desc
      limit 1
    ) r on true
    left join lateral (
      select a1.*
      from public.attempts a1
      where a1.canonical_participant_id = p.id
        and a1.is_preview = false
      order by a1.attempt_number desc, a1.created_at desc, a1.id desc
      limit 1
    ) latest_attempt on true
    left join lateral (
      select a1.id, a1.score, a1.finalized_at
      from public.attempts a1
      where a1.canonical_participant_id = p.id
        and a1.status = 'FINALIZED'
        and a1.is_preview = false
      order by a1.finalized_at desc nulls last, a1.created_at desc, a1.id desc
      limit 1
    ) latest_finalized on true
    left join lateral (
      select
        count(*)::integer as certificate_count,
        count(*) filter (where pc.status::text = 'PUBLISHED')::integer as published_certificate_count
      from public.participant_certificates pc
      where pc.participant_id = p.id
        and pc.user_id = v_uid
    ) certs on true
  ),
  claimed_collective_rows as (
    select
      jsonb_build_object(
        'entry_id', coalesce(p.id, cp.id),
        'participant_type', 'COLLECTIVE',
        'participant', jsonb_build_object(
          'id', p.id,
          'full_name', cp.full_name,
          'participant_type', 'COLLECTIVE',
          'participant_code', cp.participant_code,
          'class_name', cp.class_name,
          'grade', cp.grade
        ),
        'competition', jsonb_build_object(
          'id', c.id,
          'slug', c.slug,
          'title', c.title,
          'category', c.category,
          'status', c.status,
          'poster_url', c.poster_url,
          'registration_starts_at', c.registration_starts_at,
          'registration_ends_at', c.registration_ends_at,
          'starts_at', c.starts_at,
          'ends_at', c.ends_at,
          'announcement_at', c.announcement_at
        ),
        'registration', null,
        'latest_attempt', case
          when latest_attempt.id is null then null
          else jsonb_build_object(
            'id', latest_attempt.id,
            'status', latest_attempt.status,
            'attempt_number', latest_attempt.attempt_number,
            'started_at', latest_attempt.started_at,
            'expires_at', latest_attempt.expires_at,
            'submitted_at', latest_attempt.submitted_at,
            'finalized_at', latest_attempt.finalized_at
          )
        end,
        'result', jsonb_build_object(
          'published',
            latest_finalized.id is not null
            and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED'),
          'score', case
            when latest_finalized.id is not null
             and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
            then latest_finalized.score
            else null
          end,
          'rank', case
            when latest_finalized.id is not null
             and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
             and p.id is not null
            then private.canonical_competition_rank(c.id, p.id)
            else null
          end,
          'finalized_at', latest_finalized.finalized_at
        ),
        'certificate_count', coalesce(certs.certificate_count, 0),
        'published_certificate_count', coalesce(certs.published_certificate_count, 0)
      ) as item,
      greatest(
        coalesce(latest_attempt.updated_at, latest_attempt.created_at),
        cp.updated_at,
        p.updated_at,
        c.created_at
      ) as activity_at
    from public.collective_participants cp
    join public.competitions c on c.id = cp.competition_id
    left join public.participants p
      on p.competition_id = cp.competition_id
     and p.collective_participant_id = cp.id
     and p.participant_type = 'COLLECTIVE'
    left join lateral (
      select a1.*
      from public.attempts a1
      where (
        (p.id is not null and a1.canonical_participant_id = p.id)
        or (p.id is null and a1.collective_participant_id = cp.id)
      )
        and a1.is_preview = false
      order by a1.attempt_number desc, a1.created_at desc, a1.id desc
      limit 1
    ) latest_attempt on true
    left join lateral (
      select a1.id, a1.score, a1.finalized_at
      from public.attempts a1
      where (
        (p.id is not null and a1.canonical_participant_id = p.id)
        or (p.id is null and a1.collective_participant_id = cp.id)
      )
        and a1.status = 'FINALIZED'
        and a1.is_preview = false
      order by a1.finalized_at desc nulls last, a1.created_at desc, a1.id desc
      limit 1
    ) latest_finalized on true
    left join lateral (
      select
        count(*)::integer as certificate_count,
        count(*) filter (where pc.status::text = 'PUBLISHED')::integer as published_certificate_count
      from public.participant_certificates pc
      where pc.participant_id = p.id
        and pc.collective_participant_id = cp.id
        and exists (
          select 1
          from public.collective_participants owner_cp
          where owner_cp.id = cp.id
            and owner_cp.user_id = v_uid
        )
    ) certs on true
    where cp.user_id = v_uid
  ),
  all_rows as (
    select item, activity_at from individual_rows
    union all
    select item, activity_at from claimed_collective_rows
  )
  select coalesce(
    jsonb_agg(item order by activity_at desc nulls last),
    '[]'::jsonb
  )
  into v_result
  from all_rows;

  return v_result;
end;
$function$;

revoke all on function public.list_my_competition_dashboard()
  from public, anon, authenticated;
grant execute on function public.list_my_competition_dashboard()
  to authenticated, service_role;

commit;
