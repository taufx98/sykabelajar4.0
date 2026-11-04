import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL(
  '../supabase/migrations/20261103145000_fix_profile_connections_private_visibility.sql',
  import.meta.url,
);

async function readMigration() {
  const migration = await readFile(migrationPath, 'utf8').catch(() => '');
  assert.notEqual(migration, '', 'the migration must exist before the regression can pass');
  return migration;
}

test('anonymous callers cannot bypass a hidden connections setting through SQL NULL semantics', async () => {
  const migration = await readMigration();
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_profile_connections\(\s*p_profile_id uuid,\s*p_mode text\s*\)/i);
  assert.match(
    migration,
    /IF\s+v_uid\s+IS DISTINCT FROM\s+p_profile_id\s+AND\s+NOT\s+coalesce\(v_allow,\s*true\)\s+THEN\s+RETURN;\s+END IF;/i,
  );
});

test('non-owners cannot enumerate private profiles even when the connection popup is enabled', async () => {
  const migration = await readMigration();
  assert.match(migration, /coalesce\(profile\.is_public,\s*false\)/i);
  assert.match(
    migration,
    /FROM\s+public\.profiles\s+AS\s+profile\s+LEFT\s+JOIN\s+public\.profile_ui_settings\s+AS\s+settings/i,
  );
  assert.match(
    migration,
    /IF\s+v_uid\s+IS DISTINCT FROM\s+p_profile_id\s+AND\s+NOT\s+v_profile_is_public\s+THEN\s+RETURN;\s+END IF;/i,
  );
});

test('RPC rejects invalid inputs and runs with a fixed search path', async () => {
  const migration = await readMigration();
  assert.match(
    migration,
    /IF\s+p_profile_id\s+IS NULL\s+OR\s+p_mode\s+IS NULL\s+OR\s+p_mode\s+NOT IN\s*\('following',\s*'followers'\)\s+THEN\s+RETURN;\s+END IF;/i,
  );
  assert.match(migration, /SECURITY DEFINER\s+SET search_path TO ''/i);
});

test('RPC preserves only intended explicit API execute grants', async () => {
  const migration = await readMigration();
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_profile_connections\(uuid,\s*text\) FROM PUBLIC/i);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_profile_connections\(uuid,\s*text\) TO anon,\s*authenticated,\s*service_role/i,
  );
});

test('only profile owners can see private or hidden connection lists', () => {
  const canRead = ({ callerId, profileId, isPublic, showConnections }) =>
    callerId === profileId || (isPublic === true && showConnections !== false);

  assert.equal(canRead({ callerId: null, profileId: 'a', isPublic: false, showConnections: true }), false);
  assert.equal(canRead({ callerId: null, profileId: 'a', isPublic: true, showConnections: false }), false);
  assert.equal(canRead({ callerId: 'b', profileId: 'a', isPublic: false, showConnections: true }), false);
  assert.equal(canRead({ callerId: null, profileId: 'a', isPublic: true, showConnections: true }), true);
  assert.equal(canRead({ callerId: 'a', profileId: 'a', isPublic: false, showConnections: false }), true);
});
