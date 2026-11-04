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

test('guard is a fixed-search-path SECURITY DEFINER trigger function, not an exposed RPC', async () => {
  const migration = await readMigration();
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.guard_profile_server_managed_fields\(\)/i);
  assert.match(migration, /RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO ''/i);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.guard_profile_server_managed_fields\(\) FROM PUBLIC, anon, authenticated/i,
  );
});

test('trigger reads the JWT role claim, not current_user or deprecated auth.role()', async () => {
  const migration = await readMigration();
  assert.match(migration, /v_request_role text := coalesce\(auth\.jwt\(\) ->> 'role', ''\)/i);
  assert.doesNotMatch(migration, /auth\.role\s*\(/i);
  assert.match(migration, /v_is_admin := coalesce\(private\.current_user_is_admin\(\), false\)/i);
  assert.match(migration, /IF v_request_role IN \('anon', 'authenticated'\) AND NOT v_is_admin THEN/i);
});

test('non-admin client updates cannot change server-managed profile columns', async () => {
  const migration = await readMigration();
  for (const field of ['id', 'status', 'verification_type', 'school_id', 'created_at']) {
    const expected = new RegExp('NEW\\.' + field + '\\s+IS DISTINCT FROM\\s+OLD\\.' + field, 'i');
    assert.match(migration, expected);
  }
  assert.match(migration, /PROFILE_FIELD_MANAGED_BY_BACKEND/);
});

test('seven-day display-name cooldown is enforced by the database', async () => {
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

test('trigger runs before updates and client table grants follow least privilege', async () => {
  const migration = await readMigration();
  assert.match(migration, /CREATE TRIGGER zz_profiles_server_managed_fields_guard\s+BEFORE UPDATE ON public\.profiles/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.profiles FROM anon, authenticated/i);
  assert.match(migration, /GRANT SELECT ON TABLE public\.profiles TO anon/i);
  assert.match(migration, /GRANT SELECT, UPDATE ON TABLE public\.profiles TO authenticated/i);
});

test('ordinary authenticated profile updates remain available without insert or delete access', async () => {
  const migration = await readMigration();
  assert.match(migration, /GRANT SELECT, UPDATE ON TABLE public\.profiles TO authenticated/i);
  assert.doesNotMatch(migration, /GRANT [^;]*(?:INSERT|DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)[^;]* TO authenticated/i);
});

test('isolated PostgreSQL integration tests execute the migration and exercise caller roles', async () => {
  const integrationPath = new URL(
    './profile-managed-fields-integration.sql',
    import.meta.url,
  );
  const sql = await readFile(integrationPath, 'utf8');
  assert.match(sql, /\\ir \.\.\/supabase\/migrations\/20261104040000_profile_managed_fields_guard\.sql/);
  for (const marker of [
    'SET LOCAL ROLE anon',
    'SET LOCAL ROLE authenticated',
    'SET LOCAL ROLE service_role',
    'PROFILE_FIELD_MANAGED_BY_BACKEND',
    'PROFILE_NAME_CHANGE_COOLDOWN',
    'PROFILE_NAME_CHANGE_TIMESTAMP_MANAGED_BY_BACKEND',
    'profile_test_admins',
    'profile_test_admin_update',
    'has_table_privilege',
    'Attempted cross-user edit',
  ]) {
    assert.ok(sql.includes(marker), 'integration test must cover ' + marker);
  }
});

test('integration runner only accepts the disposable localhost PostgreSQL URL', async () => {
  const runnerPath = new URL(
    './run-profile-managed-fields-integration.sh',
    import.meta.url,
  );
  const runner = await readFile(runnerPath, 'utf8');
  assert.match(runner, /postgres:\/\/postgres:postgres@localhost:5432\/postgres/);
  assert.match(runner, /Refusing to run profile security integration SQL/);
  assert.match(runner, /psql "\$PROFILE_SECURITY_TEST_DATABASE_URL"/);
});
