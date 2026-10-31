import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261101090000_stage_5_teacher_achievement_report.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/teacherAchievement.service.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/GuruAchievementPage.tsx', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('teacher report is a server-authoritative, authenticated RPC', () => {
  assert.match(migration, /SECURITY DEFINER/i);
  assert.match(migration, /SET search_path TO ''/i);
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /user_roles/i);
  assert.match(migration, /role\s*=\s*'teacher'/i);
  assert.match(migration, /managed_by_user_id\s*=\s*v_user_id/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated/i);
});

test('teacher report reads canonical participant and official attempt records only', () => {
  assert.match(migration, /public\.participants/i);
  assert.match(migration, /canonical_participant_id/i);
  assert.match(migration, /is_preview\s*=\s*false/i);
  assert.match(migration, /private\.canonical_competition_rank/i);
  assert.match(migration, /FINALIZED/i);
});

test('unpublished results never expose score, rank, or certificate details', () => {
  assert.match(migration, /RESULT_PUBLISHED/);
  assert.match(migration, /ARCHIVED/);
  assert.match(migration, /CASE\\s+WHEN[\s\S]*RESULT_PUBLISHED[\s\S]*THEN[\s\S]*score/i);
  assert.match(migration, /CASE\\s+WHEN[\s\S]*RESULT_PUBLISHED[\s\S]*THEN[\s\S]*canonical_competition_rank/i);
});

test('frontend uses the scoped report RPC and exposes the teacher route', () => {
  assert.match(service, /rpc\(['"]list_teacher_achievement_report['"]/);
  assert.match(page, /listTeacherAchievementReport/);
  assert.match(page, /Unduh laporan/);
  assert.match(routes, /path="\/guru\/prestasi"/);
  assert.match(routes, /GuruAchievementPage/);
});
