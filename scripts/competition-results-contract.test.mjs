import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20261031214300_stage_3_competition_results_publication.sql', import.meta.url);
const sql = await readFile(migrationPath, 'utf8');
const manualServicePath = new URL('../src/services/manualGrading.service.ts', import.meta.url);
const manualService = await readFile(manualServicePath, 'utf8');

test('canonical results use one latest finalized non-preview attempt per participant and rank ties', () => {
  assert.match(sql, /DISTINCT ON \(a\.canonical_participant_id\)/);
  assert.match(sql, /a\.status::text = 'FINALIZED'/);
  assert.match(sql, /a\.is_preview = false/);
  assert.match(sql, /rank\(\) OVER \(ORDER BY lf\.score DESC NULLS LAST\)/);
});

test('manual and AI grading serialize against finalization on the same attempt row', () => {
  const saveStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.save_manual_grading_item');
  const limitsStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_attempt_grading_limits', saveStart);
  const saveSql = sql.slice(saveStart, limitsStart);
  assert.match(saveSql, /SELECT gi\.attempt_id INTO v_attempt_id[\s\S]*FROM public\.attempts[\s\S]*FOR UPDATE[\s\S]*FROM public\.grading_items[\s\S]*FOR UPDATE/);
  assert.match(saveSql, /require_organizer_entitlement\([\s\S]*'manual_grading'/);
  assert.match(saveSql, /private\.current_user_is_organizer_for/);

  const aiStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.grade_essay_similarity');
  const finalizeStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.finalize_attempt_manual', aiStart);
  const aiSql = sql.slice(aiStart, finalizeStart);
  assert.match(aiSql, /FROM public\.attempts\s+WHERE id = p_attempt_id\s+FOR UPDATE/);

  const finalizeSql = sql.slice(finalizeStart, sql.indexOf('CREATE OR REPLACE FUNCTION private.canonical_competition_results', finalizeStart));
  assert.match(finalizeSql, /FROM public\.attempts\s+WHERE id = p_attempt_id\s+FOR UPDATE/);
});

test('manual finalization preserves the automatic base and applies manual/AI adjustments server-side', () => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.finalize_attempt_manual');
  const end = sql.indexOf('CREATE OR REPLACE FUNCTION private.canonical_competition_results', start);
  const finalizeSql = sql.slice(start, end);
  assert.match(finalizeSql, /coalesce\(v_attempt\.score, 0\)/);
  assert.match(finalizeSql, /coalesce\(v_manual_score, 0\)/);
  assert.match(finalizeSql, /coalesce\(v_ai_adjustment, 0\)/);
  assert.match(finalizeSql, /gi\.score - gi\.automatic_score/);
  assert.match(finalizeSql, /MANUAL_GRADING_INCOMPLETE/);
  assert.doesNotMatch(finalizeSql, /MANUAL_GRADING_ITEMS_NOT_FOUND/);
  assert.match(finalizeSql, /SET score = v_final_score/);
  assert.doesNotMatch(finalizeSql, /SET score = p_score/);
});

test('automatic_score only marks built-in linear AI scores already included in attempts.score', () => {
  const backfill = sql.slice(0, sql.indexOf('CREATE OR REPLACE FUNCTION private.capture_automatic_grading_score'));
  assert.match(backfill, /gi\.grader_id IS NULL/);
  assert.match(backfill, /FROM public\.exam_attempt_runtime runtime/);
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION private.capture_automatic_grading_score');
  const end = sql.indexOf('CREATE OR REPLACE FUNCTION public.save_manual_grading_item', start);
  const triggerSql = sql.slice(start, end);
  assert.match(triggerSql, /current_user = 'postgres'/);
  assert.match(triggerSql, /exam_attempt_runtime runtime/);
  assert.match(triggerSql, /OLD\.automatic_score IS NOT NULL/);
  assert.match(triggerSql, /AUTOMATIC_SCORE_IS_SERVER_MANAGED/);
  assert.doesNotMatch(triggerSql, /ELSIF NEW\.grader_id IS NULL/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.grading_items\s+FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.grading_items\s+TO authenticated/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.attempts\s+FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.attempts\s+TO authenticated/);
  assert.match(sql, /UPDATE OF score, feedback, automatic_score/);
});

test('grading UI receives safe question snapshot data only through an authorized RPC', () => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_attempt_grading_limits');
  const end = sql.indexOf('CREATE OR REPLACE FUNCTION public.grade_essay_similarity', start);
  const limitsSql = sql.slice(start, end);
  assert.match(limitsSql, /exam_attempt_questions/);
  assert.match(limitsSql, /points_snapshot/);
  assert.match(limitsSql, /question_snapshot jsonb/);
  assert.match(limitsSql, /ai_assessment_enabled/);
  assert.doesNotMatch(limitsSql, /answer_key_snapshot->>'answer_key'/);
  assert.match(limitsSql, /private\.current_user_is_organizer_for/);
  assert.match(limitsSql, /REVOKE ALL ON FUNCTION public\.get_attempt_grading_limits\(uuid\)\s+FROM PUBLIC, anon/);
  assert.doesNotMatch(manualService, /\.from\('questions'\)/);
  assert.match(manualService, /get_attempt_grading_limits/);
});

test('AI essay grading uses snapshot answer keys, enforces enablement and scores only questions in this attempt', () => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.grade_essay_similarity');
  const end = sql.indexOf('CREATE OR REPLACE FUNCTION public.finalize_attempt_manual', start);
  const aiSql = sql.slice(start, end);
  assert.match(aiSql, /eq\.answer_key_snapshot->>'answer_key'/);
  assert.match(aiSql, /v_question_points/);
  assert.match(aiSql, /v_ai_enabled/);
  assert.match(aiSql, /AI_ASSESSMENT_DISABLED/);
  assert.match(aiSql, /question_bank_id/);
  assert.match(aiSql, /exam_attempt_runtime/);
  assert.match(aiSql, /v_similarity := public\.calculate_text_similarity/);
  assert.match(aiSql, /RETURN v_similarity/);
});

test('publication reconciles timed-out linear sessions and blocks unfinished official attempts', () => {
  assert.match(sql, /private\.resolve_linear_exam_timeouts/);
  assert.match(sql, /runtime\.global_deadline <= clock_timestamp\(\)/);
  assert.match(sql, /LINEAR_TIMEOUT_RECONCILIATION_STALLED/);
  assert.match(sql, /v_runtime_position = v_previous_position/);
  const publishStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.publish_competition_results');
  const publicResultsStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_public_competition_results', publishStart);
  const publishSql = sql.slice(publishStart, publicResultsStart);
  const attemptLoopStart = publishSql.indexOf('FOR v_attempt_id IN');
  const batchComment = publishSql.indexOf('-- The resolver itself processes at most 200 question transitions per call.', attemptLoopStart);
  const innerLoopStart = publishSql.indexOf('    LOOP', batchComment);
  const resolverCall = publishSql.indexOf('PERFORM private.resolve_linear_exam_timeouts(', innerLoopStart);
  const innerLoopEnd = publishSql.indexOf('    END LOOP;', resolverCall);
  const outerLoopEnd = publishSql.indexOf('  END LOOP;', innerLoopEnd + 1);
  assert.ok(attemptLoopStart >= 0 && batchComment > attemptLoopStart);
  assert.ok(innerLoopStart > batchComment && resolverCall > innerLoopStart);
  assert.ok(innerLoopEnd > resolverCall && outerLoopEnd > innerLoopEnd);
  assert.match(sql, /NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'GRADING/);
  assert.match(sql, /MISSING_CANONICAL_IDENTITY/);
  assert.match(sql, /NO_FINALIZED_OFFICIAL_ATTEMPTS/);
  assert.match(sql, /'RESULT_PUBLISHED'::public\.competition_status/);
});

test('public results require a public competition whose official results are published', () => {
  assert.match(sql, /visibility = 'PUBLIC'/);
  assert.match(sql, /status::text IN \('RESULT_PUBLISHED', 'ARCHIVED'\)/);
  assert.match(sql, /private\.canonical_competition_results/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_public_competition_results/);
});

test('organizer-only endpoints are not granted to anon and use edit authorization', () => {
  assert.match(sql, /private\.current_user_can_edit_competition/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_organizer_competition_result_overview\(uuid, integer, integer\)\s+FROM PUBLIC, anon/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.publish_competition_results\(uuid\)\s+FROM PUBLIC, anon/);
});
