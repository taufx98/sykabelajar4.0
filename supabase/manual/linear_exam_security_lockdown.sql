begin;

-- Phase 2: apply only after the new individual and collective exam UI is deployed.
-- At that point, all participants use one-question server-authoritative RPCs.

-- Participants cannot write arbitrary answer rows through PostgREST; drafts and
-- locked answers must go through the server-side question state machine.
drop policy if exists answer_self_insert on public.answers;
drop policy if exists answer_self_update on public.answers;

-- Do not expose finished attempt score/status through direct reads by participants.
drop policy if exists attempts_admin_or_owner_read on public.attempts;
create policy attempts_admin_or_owner_read on public.attempts
for select to authenticated
using (
  (participant_id = (select auth.uid()) and status in ('NOT_STARTED','IN_PROGRESS'))
  or private.current_user_is_admin()
  or exists (
    select 1 from public.competitions c
    where c.id = attempts.competition_id
      and c.organizer_id is not null
      and private.current_user_is_organizer_for(c.organizer_id)
  )
);

-- Participants must use the one-question RPC, never a raw SELECT of the full question bank.
drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions
for select to authenticated
using (
  private.current_user_is_admin()
  or exists (
    select 1 from public.question_banks qb
    where qb.id = questions.question_bank_id
      and qb.organizer_id is not null
      and private.current_user_is_organizer_for(qb.organizer_id)
  )
  or exists (
    select 1 from public.competitions c
    where c.id = questions.competition_id
      and c.organizer_id is not null
      and private.current_user_is_organizer_for(c.organizer_id)
  )
);

-- Prevent direct result RPCs from revealing a finalized score before public announcement.
create or replace function public.get_canonical_competition_result(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.participants%rowtype;
  a public.attempts%rowtype;
  c public.competitions%rowtype;
  v_rank bigint;
begin
  select * into p from public.participants where id=p_participant_id;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if not private.current_user_is_admin()
     and (p.user_id is null or p.user_id<>auth.uid())
     and not exists(
       select 1 from public.collective_participants cp
       where cp.id=p.collective_participant_id and cp.managed_by_user_id=auth.uid()
     ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into c from public.competitions where id=p.competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;

  if not private.current_user_is_admin() and c.status not in ('RESULT_PUBLISHED','ARCHIVED') then
    return jsonb_build_object(
      'participant_id',p.id,
      'competition_id',p.competition_id,
      'participant_type',p.participant_type,
      'name',p.full_name,
      'attempt',null,
      'rank',null,
      'published',false
    );
  end if;

  select * into a
  from public.attempts
  where canonical_participant_id=p.id and status='FINALIZED'
  order by finalized_at desc nulls last,created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'participant_id',p.id,
      'competition_id',p.competition_id,
      'participant_type',p.participant_type,
      'name',p.full_name,
      'attempt',null,
      'rank',null,
      'published',true
    );
  end if;

  select 1+count(*) into v_rank
  from public.attempts x
  where x.competition_id=p.competition_id
    and x.status='FINALIZED'
    and x.canonical_participant_id is not null
    and x.score>a.score;

  return jsonb_build_object(
    'participant_id',p.id,
    'competition_id',p.competition_id,
    'participant_type',p.participant_type,
    'name',p.full_name,
    'attempt',jsonb_build_object('id',a.id,'status',a.status,'score',a.score,'finalized_at',a.finalized_at),
    'rank',v_rank,
    'published',true
  );
end;
$$;

revoke all on function public.get_canonical_competition_result(uuid) from public, anon, authenticated;
grant execute on function public.get_canonical_competition_result(uuid) to authenticated;

-- Remove legacy RPC paths which disclosed every question at once or bypassed the
-- per-question server state machine. New clients use the linear RPCs below.
revoke execute on function public.start_competition_attempt(uuid) from public, anon, authenticated;
revoke execute on function public.get_participant_questions(uuid) from public, anon, authenticated;
revoke execute on function public.get_attempt_resume(uuid) from public, anon, authenticated;
revoke execute on function public.save_attempt_answer(uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.submit_competition_attempt(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.start_collective_competition_attempt(text,uuid) from public, anon, authenticated;
revoke execute on function public.get_collective_participant_questions(text,uuid) from public, anon, authenticated;
revoke execute on function public.get_collective_attempt_answers(text,uuid) from public, anon, authenticated;
revoke execute on function public.save_collective_attempt_answer(text,uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.submit_collective_competition_attempt(text,uuid,uuid) from public, anon, authenticated;

commit;
