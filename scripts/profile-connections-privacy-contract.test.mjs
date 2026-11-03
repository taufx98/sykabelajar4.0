import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL(
  '../supabase/migrations/20261103145000_fix_profile_connections_private_visibility.sql',
  import.meta.url,
);

test('anonymous callers cannot bypass a private connections setting through SQL NULL semantics', async () => {
  const migration = await readFile(migrationPath, 'utf8').catch(() => '');

  assert.notEqual(
    migration,
    '',
    'the profile connections privacy migration must exist before this regression can pass',
  );
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\\.get_profile_connections\\(\\s*p_profile_id uuid,\\s*p_mode text\\s*\\)/i);
  assert.match(
    migration,
    /IF\s+v_uid\s+IS DISTINCT FROM\s+p_profile_id\s+AND\s+NOT\s+coalesce\(v_allow,\s*true\)\s+THEN\s+RETURN;\s+END IF;/i,
    'NULL auth.uid() must be treated as a non-owner, not as an owner',
  );
});

test('profile connections RPC rejects missing IDs and unknown modes and uses a fixed search path', async () => {
  const migration = await readFile(migrationPath, 'utf8').catch(() => '');

  assert.match(
    migration,
    /IF\s+p_profile_id\s+IS NULL\s+OR\s+p_mode\s+IS NULL\s+OR\s+p_mode\s+NOT IN\s*\('following',\s*'followers'\)\s+THEN\s+RETURN;\s+END IF;/i,
  );
  assert.match(migration, /SECURITY DEFINER\s+SET search_path TO ''/i);
});

test('profile connections RPC keeps only the intended explicit API grants', async () => {
  const migration = await readFile(migrationPath, 'utf8').catch(() => '');

  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.get_profile_connections\(uuid,\s*text\) FROM PUBLIC/i,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_profile_connections\(uuid,\s*text\) TO anon,\s*authenticated,\s*service_role/i,
  );
});
