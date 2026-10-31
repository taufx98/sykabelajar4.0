import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20261031214300_stage_3_competition_results_publication.sql', import.meta.url);
const sql = await readFile(migrationPath, 'utf8');

test('canonical results use one latest finalized non-preview attempt per participant and rank ties', () => {
  assert.match(sql, /DISTINCT ON \(a\.canonical_participant_id\)/);
  assert.match(sql, /a\.status::text = 'FINALIZED'/);
  assert.match(sql, /a\.is_preview = false/);
  assert.match(sql, /rank\(\) OVER \(ORDER BY lf\.score DESC NULLS LAST\)/);
});

test('manual finalization preserves automatic base points and applies manual deltas on the server', () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS automatic_score numeric/);
  assert.match(sql, /coalesce\(v_attempt\.score, 0\)/);
  assert.match(sql, /gi\.score - gi\.automatic_score/);
  assert.match(sql, /MANUAL_GRADING_INCOMPLETE/);
  assert.match(sql, /SET score = v_final_score/);
  assert.match(sql, /p_score remains in the function signature|Never trust a score submitted by the browser/);
});

test('result publication reconciles expired linear sessions and blocks unfinished official attempts', () => {
  assert.match(sql, /private\.resolve_linear_exam_timeouts/);
  assert.match(sql, /runtime\.global_deadline <= clock_timestamp\(\)/);
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
