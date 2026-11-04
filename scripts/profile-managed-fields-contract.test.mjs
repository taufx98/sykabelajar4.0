import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL(
  '../supabase/migrations/20261104040000_profile_managed_fields_guard.sql',
  import.meta.url,
);

async function readMigration() {
  const migration = await readFile(migrationPath, 'utf8').catch(() => '');
  assert.notEqual(migration, '', 'profile managed-fields migration must exist');
  return migration;
}

test('guard is a fixed-search-path trigger function, not an exposed SECURITY DEFINER RPC', async () => {
  const migration = await readMigration();
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.guard_profile_server_managed_fields\(\)/i);
  assert.match(migration, /RETURNS trigger\s+LANGUAGE plpgsql\s+SET search_path TO ''/i);
  assert.doesNotMatch(migration, /SECURITY DEFINER/i);
});

test('direct client updates cannot change server-managed profile columns', async () => {
  const migration = await readMigration();
  for (const field of ['id', 'status', 'verification_type', 'school_id', 'created_at']) {
    const expected = new RegExp('NEW\\.' + field + '\\s+IS DISTINCT FROM\\s+OLD\\.' + field, 'i');
    assert.match(migration, expected);
  }
  assert.match(migration, /current_user IN \('anon', 'authenticated'\)/i);
  assert.match(migration, /PROFILE_FIELD_MANAGED_BY_BACKEND/);
});

test('seven-day display-name cooldown is enforced server-side', async () => {
  const migration = await readMigration();
  assert.match(migration, /OLD\.last_name_change\s*>\s*statement_timestamp\(\)\s*-\s*interval '7 days'/i);
  assert.match(migration, /PROFILE_NAME_CHANGE_COOLDOWN/);
  assert.match(migration, /NEW\.last_name_change\s*:=\s*statement_timestamp\(\)/i);
});

test('clients cannot edit the cooldown timestamp independently', async () => {
  const migration = await readMigration();
  assert.match(
    migration,
    /ELSIF\s+NEW\.last_name_change\s+IS DISTINCT FROM\s+OLD\.last_name_change\s+THEN\s+RAISE EXCEPTION 'PROFILE_NAME_CHANGE_TIMESTAMP_MANAGED_BY_BACKEND'/i,
  );
});

test('trigger runs before updates and anonymous direct writes are revoked', async () => {
  const migration = await readMigration();
  assert.match(migration, /CREATE TRIGGER zz_profiles_server_managed_fields_guard\s+BEFORE UPDATE ON public\.profiles/i);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.profiles FROM anon/i);
});

test('ordinary authenticated profile updates remain available', async () => {
  const migration = await readMigration();
  assert.doesNotMatch(migration, /REVOKE\s+UPDATE\s+ON\s+TABLE\s+public\.profiles\s+FROM\s+authenticated/i);
});
