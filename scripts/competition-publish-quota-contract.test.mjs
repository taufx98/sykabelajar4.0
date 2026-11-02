import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261102074500_monthly_competition_publication_quota.sql', import.meta.url),
  'utf8',
);
const createPage = await readFile(
  new URL('../src/pages/OrganizerCompetitionCreatePage.tsx', import.meta.url),
  'utf8',
);
const configPage = await readFile(
  new URL('../src/pages/OrganizerCompetitionConfigPage.tsx', import.meta.url),
  'utf8',
);
const organizerPlanPage = await readFile(
  new URL('../src/pages/OrganizerPlanPage.tsx', import.meta.url),
  'utf8',
);
const adminPlanPage = await readFile(
  new URL('../src/pages/AdminPlanUsagePage.tsx', import.meta.url),
  'utf8',
);

const lowerMigration = migration.toLowerCase();
const createStart = lowerMigration.indexOf('create or replace function public.create_organizer_competition');
const createEnd = migration.indexOf('$function$;', createStart);
const createFunction = migration.slice(createStart, createEnd).toLowerCase();
const transitionStart = lowerMigration.indexOf('create or replace function public.transition_competition');
const transitionEnd = migration.indexOf('$function$;', transitionStart);
const transitionFunction = migration.slice(transitionStart, transitionEnd).toLowerCase();

test('creating and saving a competition draft does not consume or block on the publish quota', () => {
  assert.ok(createStart >= 0, 'migration replaces the existing organizer competition create RPC');
  assert.equal(createFunction.includes('competition_quota_exceeded'), false);
  assert.equal(createFunction.includes("'draft'"), true);
  assert.equal(createPage.includes('quotaReached'), false);
  assert.equal(createPage.includes('create_organizer_competition'), true);
});

test('publication quota is counted by first publish within the Jakarta calendar month', () => {
  assert.equal(lowerMigration.includes('asia/jakarta'), true);
  assert.equal(lowerMigration.includes("date_trunc('month'"), true);
  assert.equal(lowerMigration.includes('competition_status_history'), true);
  assert.equal(lowerMigration.includes('count(distinct h.competition_id)'), true);
  assert.equal(lowerMigration.includes("h.to_status::text = 'published'"), true);
  assert.equal(transitionFunction.includes('pg_advisory_xact_lock'), true);
  assert.equal(transitionFunction.includes('competition_quota_exceeded'), true);
});

test('monthly publication quota is enforced on first publish and administrators retain their bypass', () => {
  assert.equal(transitionFunction.includes("p_to_status = 'published'::public.competition_status"), true);
  assert.equal(transitionFunction.includes('if not v_already_published then'), true);
  assert.equal(transitionFunction.includes('private.monthly_organizer_competition_quota'), true);
  assert.equal(transitionFunction.includes('current_user_is_admin'), true);
});

test('organizer quota status RPC is authorized and not exposed to anonymous users', () => {
  assert.equal(lowerMigration.includes('create or replace function public.get_organizer_competition_quota'), true);
  assert.equal(lowerMigration.includes('current_user_can_edit_competition'), true);
  assert.equal(lowerMigration.includes('revoke all on function public.get_organizer_competition_quota(uuid) from public, anon'), true);
  assert.equal(lowerMigration.includes('grant execute on function public.get_organizer_competition_quota(uuid) to authenticated'), true);
});

test('configuration save stays enabled while Release is locked at quota and shows the first-day reset', () => {
  assert.equal(configPage.includes('get_organizer_competition_quota'), true);
  assert.equal(configPage.includes('competitionQuota?.can_publish'), true);
  assert.equal(configPage.includes('competitionQuota?.reset_at'), true);
  assert.equal(configPage.includes('00.00 WIB'), true);
  assert.equal(configPage.includes('Simpan Konfigurasi'), true);
  assert.equal(configPage.includes('Kuota Habis'), true);
  assert.equal(configPage.includes('disabled={saving || questionCountLoading || quotaLoading || competitionQuota?.can_publish !== true}'), true);
});

test('a quota race on release leaves the draft intact and refreshes quota feedback', () => {
  assert.equal(configPage.includes('COMPETITION_QUOTA_EXCEEDED'), true);
  assert.equal(configPage.includes('refreshOrganizerCompetitionQuota'), true);
  assert.equal(configPage.includes('reset_at'), true);
});

test('organizer and admin plan panels describe competition_create as monthly publications', () => {
  assert.equal(organizerPlanPage.includes("competition_create: 'Publikasi lomba per bulan'"), true);
  assert.equal(adminPlanPage.includes("competition_create: 'Publikasi lomba per bulan'"), true);
});
