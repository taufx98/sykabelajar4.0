begin;

-- Keep the total competition duration as the single global clock.
-- Per-question base time is divided from this duration in prepare_linear_exam_runtime.
-- The 60-second speed bonus applies only to the current question's deadline,
-- without extending the overall competition deadline.
do $migration$
declare
  v_definition text;
  v_old_duration text := $old_duration$  v_duration_minutes := case
    when coalesce(v_comp.config->>'duration_minutes','') ~ '^[0-9]+$'
      then case when (v_comp.config->>'duration_minutes')::integer > 0
        then greatest(1, least(1440, (v_comp.config->>'duration_minutes')::integer))
        else 0 end
    else 0
  end;$old_duration$;
  v_new_duration text := $new_duration$  v_duration_minutes := greatest(1, least(1440,
    case
      when coalesce(v_comp.config->>'duration_minutes','') ~ '^[0-9]+$'
        and (v_comp.config->>'duration_minutes')::integer > 0
      then (v_comp.config->>'duration_minutes')::integer
      else 60
    end
  ));$new_duration$;
  v_old_deadline text := $old_deadline$  v_global_deadline := v_started_at + make_interval(secs => v_duration_seconds + (greatest(0, v_question_count - 1) * 60));$old_deadline$;
  v_new_deadline text := $new_deadline$  v_global_deadline := v_started_at + make_interval(secs => v_duration_seconds);$new_deadline$;
begin
  select pg_get_functiondef('private.prepare_linear_exam_runtime(uuid)'::regprocedure)
    into v_definition;

  if position(v_old_duration in v_definition) = 0 then
    raise exception 'LINEAR_EXAM_DURATION_DEFAULT_ANCHOR_NOT_FOUND';
  end if;
  v_definition := replace(v_definition, v_old_duration, v_new_duration);

  if position(v_old_deadline in v_definition) = 0 then
    raise exception 'LINEAR_EXAM_GLOBAL_DEADLINE_ANCHOR_NOT_FOUND';
  end if;
  v_definition := replace(v_definition, v_old_deadline, v_new_deadline);

  execute v_definition;
end;
$migration$;

commit;
