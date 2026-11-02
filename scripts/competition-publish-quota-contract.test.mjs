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

const createStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.create_organizer_competition');
const createEnd = migration.indexOf('$function$;', createStart);
const createFunction = migration.slice(createStart, createEnd);
const transitionStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.transition_competition');
const transitionEnd = migration.indexOf('$function$;', transitionStart);
const transitionFunction = migration.slice(transitionStart, transitionEnd);

test('creating and saving a competition draft does not consume or block on the publish quota', () => {
  assert.ok(createStart >= 0, 'migration replaces the existing organizer competition create RPC');
  assert.doesNotMatch(createFunction, /COMPETITION_QUOTA_EXCEEDED/);
  assert.match(createFunction, /'DRAFT'/);
  assert.doesNotMatch(createPage, /quotaReached/);
});

test('publication quota is counted by first publish within the Jakarta calendar month', () => {
  assert.match(migration, /Asia\/Jakarta/);
  assert.match(migration, /date_trunc\('month'/i);
  assert.match(migration, /competition_status_history/);
  assert.match(migration, /from_status::text\s*=\s*'DRAFT'/i);
  assert.match(migration, /to_status::text\s*=\s*'PUBLISHED'/i);
  assert.match(transitionFunction, /pg_advisory_xact_lock/);
  assert.match(transitionFunction, /COMPETITION_QUOTA_EXCEEDED/);
});

test('monthly publication quota is enforced on the server only for DRAFT to PUBLISHED transitions', () => {
  assert.match(transitionFunction, /p_to_status\s*=\s*'PUBLISHED'/);
  assert.match(transitionFunction, /v_before\.status\s*=\s*'DRAFT'/);
  assert.match(transitionFunction, /private\.monthly_organizer_competition_quota/);
  assert.match(transitionFunction, /current_user_is_admin/);
});

test('organizer quota status RPC is authorized and not exposed to anonymous users', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_organizer_competition_quota/);
  assert.match(migration, /current_user_can_edit_competition/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_organizer_competition_quota\(uuid\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_organizer_competition_quota\(uuid\) TO authenticated/);
});

test('configuration save stays enabled while Release is locked at quota and shows the first-day reset', () => {
  assert.match(configPage, /get_organizer_competition_quota/);
  assert.match(configPage, /quota\.can_publish/);
  assert.match(configPage, /quota\.reset_at/);
  assert.match(configPage, /00\.00 WIB/);
  assert.match(configPage, /Simpan Konfigurasi/);
  assert.match(configPage, /Kuota Habis/);
  assert.match(configPage, /disabled=\{[^}]*quota\.can_publish/);
});

test('a quota race on release leaves the draft intact and refreshes quota feedback', () => {
  assert.match(configPage, /COMPETITION_QUOTA_EXCEEDED/);
  assert.match(configPage, /refreshCompetitionQuota/);
  assert.match(configPage, /reset_at/);
});
