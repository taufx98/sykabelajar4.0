import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const readGenerated = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('generated Better Auth schema includes core identity and session tables', async () => {
  const schema = await readGenerated('../src/auth-schema.ts');
  for (const model of ['user', 'session', 'account', 'verification', 'rateLimit']) {
    assert.match(schema, new RegExp('export const ' + model + '\\s*=\\s*sqliteTable'));
  }
});

test('generated schema includes OAuth Provider resources, grants, and consent tables', async () => {
  const schema = await readGenerated('../src/auth-schema.ts');
  for (const model of [
    'jwks',
    'oauthClient',
    'oauthResource',
    'oauthClientResource',
    'oauthAccessToken',
    'oauthRefreshToken',
    'oauthConsent',
    'oauthClientAssertion',
  ]) {
    assert.match(schema, new RegExp('export const ' + model + '\\s*=\\s*sqliteTable'));
  }
});

test('generated D1 migration creates the same security-critical tables', async () => {
  const migrationFiles = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((file) => file.endsWith('.sql'));
  assert.ok(migrationFiles.length > 0, 'at least one generated migration must exist');
  const migration = (await Promise.all(
    migrationFiles.map((file) => readGenerated('../migrations/' + file)),
  )).join('\n');
  for (const table of [
    'user',
    'session',
    'account',
    'verification',
    'jwks',
    'oauth_client',
    'oauth_resource',
    'oauth_client_resource',
    'oauth_access_token',
    'oauth_refresh_token',
    'oauth_consent',
    'rate_limit',
  ]) {
    assert.match(migration, new RegExp('CREATE TABLE \`' + table + '\`', 'i'));
  }
});
