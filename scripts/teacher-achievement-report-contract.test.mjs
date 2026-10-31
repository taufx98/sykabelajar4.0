import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261101000100_stage_5_teacher_achievement_report.sql', import.meta.url),
  'utf8',
);
const reportPage = await readFile(new URL('../src/pages/GuruAchievementReportPage.tsx', import.meta.url), 'utf8');
const reportService = await readFile(new URL('../src/services/teacherAchievementReport.service.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8');
const language = await readFile(new URL('../src/lib/LanguageContext.tsx', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

test('teacher report is a read-only RPC and does not create another student or participant system', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_teacher_achievement_report\(/i);
  assert.doesNotMatch(migration, /CREATE\s+TABLE/i);
  assert.doesNotMatch(migration, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?:participants|collective_participants|teacher_rosters|roster_students|attempts)\b/i);
  assert.match(migration, /RETURNS jsonb/i);
  assert.match(reportService, /rpc\('get_teacher_achievement_report'/);
});

test('teacher data is scoped to the authenticated teacher-owned roster and managed participants', () => {
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /role::text\s*=\s*'teacher'/i);
  assert.match(migration, /tr\.teacher_user_id\s*=\s*v_uid/i);
  assert.match(migration, /cp\.managed_by_user_id\s*=\s*v_uid/i);
  assert.match(migration, /p_search/i);
});

test('only official finalized non-preview attempts contribute to published scores and ranking', () => {
  assert.match(migration, /a\.status::text\s*=\s*'FINALIZED'/i);
  assert.match(migration, /a\.is_preview\s*=\s*false/i);
  assert.match(migration, /DISTINCT ON\s*\(a\.canonical_participant_id\)/i);
  assert.match(migration, /rank\\(\\)\\s+OVER\\s*\\(\\s*PARTITION BY lf\\.competition_id\\s+ORDER BY lf\\.score DESC NULLS LAST\\)/i);
  assert.match(migration, /sp\.competition_status\s+IN\s*\('RESULT_PUBLISHED',\s*'ARCHIVED'\)/i);
  assert.match(migration, /CASE\\s+WHEN sp\\.competition_status\\s+IN\\s*\\('RESULT_PUBLISHED',\\s*'ARCHIVED'\\)\\s*THEN rr\\.score/i);
});

test('report exposes only published certificates and publicly visible linked awards', () => {
  assert.match(migration, /pc\.status\s*=\s*'PUBLISHED'/i);
  assert.match(migration, /a\.visibility\s*=\s*'PUBLIC'/i);
  assert.match(migration, /a\.user_id\s*=\s*lsc\.linked_user_id/i);
  assert.match(migration, /a\.competition_id\s*=\s*lsc\.competition_id/i);
});

test('report RPC is security-definer with an empty search path and authenticated-only execution', () => {
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO ''/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_teacher_achievement_report\(integer, integer, text\)\s+FROM PUBLIC, anon, service_role/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_teacher_achievement_report\(integer, integer, text\)\s+TO authenticated/i);
  assert.match(migration, /v_limit\s*:=\s*greatest\(1,\s*least\(coalesce\(p_limit,\s*50\),\s*100\)\)/i);
});

test('teacher report page uses the protected teacher route and appears in the teacher feature navigation', () => {
  assert.match(app, /GuruAchievementReportPage/);
  assert.match(app, /path="\/guru\/laporan" element=\{<RoleRoute role="teacher"><GuruAchievementReportPage \/><\/RoleRoute>\}/);
  assert.match(layout, /'\/guru\/laporan'/);
  assert.match(layout, /\/guru\/laporan/);
  assert.match(language, /'nav\.teacherReport': 'Laporan Prestasi'/);
  assert.match(language, /'nav\.teacherReport': 'Achievement Reports'/);
});

test('report UI clearly distinguishes published results from pending results', () => {
  assert.match(reportPage, /result_published/);
  assert.match(reportPage, /Hasil belum diumumkan/);
  assert.match(reportPage, /Peringkat/);
  assert.match(reportPage, /Sertifikat/);
  assert.match(reportPage, /Ekspor CSV/);
});

test('the contract test runs in npm and GitHub Actions CI', () => {
  assert.equal(
    packageJson.scripts['test:teacher-achievement-report-contract'],
    'node --test scripts/teacher-achievement-report-contract.test.mjs',
  );
  assert.match(workflow, /npm run test:teacher-achievement-report-contract/);
});
