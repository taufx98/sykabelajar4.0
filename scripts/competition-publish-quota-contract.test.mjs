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

const lowerMigration = migration.toLowerCase();
const createStart = lowerMigration.indexOf('create or replace function public.create_organizer_competition');
const createEnd = migration.indexOf('$function$;', createStart);
const createFunction = migration.slice(createStart, createEnd);
const transitionStart = lowerMigration.indexOf('create or replace function public.transition_competition');
const transitionEnd = migration.indexOf('$function$;', transitionStart);
const transitionFunction = migration.slice(transitionStart, transitionEnd);

test('creating and saving a competition draft does not consume or block on the publish quota', () => {
  assert.ok(createStart >= 0, 'migration replaces the existing organizer competition create RPC');
  assert.doesNotMatch(createFunction, /COMPETITION_QUOTA_EXCEEDED/);
  assert.match(createFunction, /'DRAFT'/);
  assert.doesNotMatch(createPage, /quotaReached/);
});

test('publication quota is counted by first publish within the Jakarta calendar month', () => {
  assert.match(migration, /Asia\\/Jakarta/);
  assert.match(migration, /date_trunc\\('month'/i);
  assert.match(migration, /competition_status_history/);
  assert.match(migration, /count\\s*\\(distinct h\\.competition_id\\)/i);
  assert.match(migration, /h\\.to_status::text\\s*=\\s*'PUBLISHED'/i);
  assert.match(transitionFunction, /pg_advisory_xact_lock/);
  assert.match(transitionFunction, /COMPETITION_QUOTA_EXCEEDED/);
});

test('monthly publication quota is enforced on first publish and administrators retain their bypass', () => {
  assert.match(transitionFunction, /p_to_status\\s*=\\s*'PUBLISHED'/i);
  assert.match(transitionFunction, /not v_already_published/i);
  assert.match(transitionFunction, /private\\.monthly_organizer_competition_quota/i);
  assert.match(transitionFunction, /current_user_is_admin/i);
});

test('organizer quota status RPC is authorized and not exposed to anonymous users', () => {
  assert.match(migration, /create or replace function public\\.get_organizer_competition_quota/i);
  assert.match(migration, /current_user_can_edit_competition/);
  assert.match(migration, /revoke all on function public\\.get_organizer_competition_quota\\(uuid\\) from public, anon/i);
  assert.match(migration, /grant execute on function public\\.get_organizer_competition_quota\\(uuid\\) to authenticated/i);
});

test('configuration save stays enabled while Release is locked at quota and shows the first-day reset', () => {
  assert.match(configPage, /get_organizer_competition_quota/);
  assert.match(configPage, /competitionQuota\\?\\.can_publish/);
  assert.match(configPage, /competitionQuota\\?\\.reset_at/);
  assert.match(configPage, /00\\.00 WIB/);
  assert.match(configPage, /Simpan Konfigurasi/);
  assert.match(configPage, /Kuota Habis/);
  assert.match(configPage, /disabled=\\{[^}]*competitionQuota\\?\\.can_publish/);
});

test('a quota race on release leaves the draft intact and refreshes quota feedback', () => {
  assert.match(configPage, /COMPETITION_QUOTA_EXCEEDED/);
  assert.match(configPage, /refreshOrganizerCompetitionQuota/);
  assert.match(configPage, /reset_at/);
});
