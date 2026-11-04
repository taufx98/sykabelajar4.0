import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = new URL('../supabase/migrations/20261104031713_profile_connections_privacy_guard.sql', import.meta.url);
const sql = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();

test('profile connections RPC remains intentionally callable for public profile UX', () => {
  assert.match(sql, /create or replace function public\.get_profile_connections\s*\(/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.doesNotMatch(sql, /revoke\s+execute\s+on\s+function/);
});

test('RPC rejects unsupported modes and null profile identifiers', () => {
  assert.match(sql, /if p_profile_id is null then return; end if;/);
  assert.match(sql, /if p_mode is null or p_mode not in \('following', 'followers'\) then/);
});

test('RPC enforces the profile public/private boundary itself', () => {
  assert.match(sql, /from public\.profiles as profile left join public\.profile_ui_settings as settings/);
  assert.match(sql, /if not coalesce\(v_uid = p_profile_id, false\) and not coalesce\(v_profile_is_public, false\) then return; end if;/);
});

test('RPC handles anonymous auth.uid() as false before checking hidden connection lists', () => {
  assert.match(sql, /if not coalesce\(v_uid = p_profile_id, false\) and not coalesce\(v_show_connections, true\) then return; end if;/);
  assert.doesNotMatch(sql, /if\s+auth\.uid\(\)\s*<>\s*p_profile_id/);
});

test('owner can still inspect their own list while public visitors follow both visibility flags', () => {
  const canRead = ({ callerId, profileId, isPublic, showConnections }) =>
    callerId === profileId || (isPublic === true && showConnections !== false);

  assert.equal(canRead({ callerId: null, profileId: 'profile-a', isPublic: false, showConnections: true }), false);
  assert.equal(canRead({ callerId: null, profileId: 'profile-a', isPublic: true, showConnections: false }), false);
  assert.equal(canRead({ callerId: 'profile-b', profileId: 'profile-a', isPublic: false, showConnections: true }), false);
  assert.equal(canRead({ callerId: null, profileId: 'profile-a', isPublic: true, showConnections: true }), true);
  assert.equal(canRead({ callerId: 'profile-a', profileId: 'profile-a', isPublic: false, showConnections: false }), true);
});
