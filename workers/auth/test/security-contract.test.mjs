import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('auth configuration pins secure browser sessions and disables implicit OAuth account linking', async () => {
  const config = await source('../src/auth-options.ts');
  assert.match(config, /useSecureCookies:\s*true/);
  assert.match(config, /httpOnly:\s*true/);
  assert.match(config, /sameSite:\s*["']lax["']/);
  assert.match(config, /disableImplicitLinking:\s*true/);
  assert.doesNotMatch(config, /crossSubDomainCookies:\s*\{\s*enabled:\s*true/);
  assert.match(config, /generateId:\s*["']uuid["']/);
});

test('Supabase bridge issues short-lived ES256 resource-bound authenticated tokens', async () => {
  const config = await source('../src/auth-options.ts');
  assert.match(config, /alg:\s*["']ES256["']/);
  assert.match(config, /accessTokenTtl:\s*300/);
  assert.match(config, /role:\s*["']authenticated["']/);
  assert.match(config, /allowDynamicClientRegistration:\s*false/);
  assert.match(config, /disableSettingJwtHeader:\s*true/);
  assert.match(config, /disabledPaths:\s*\[["']\/token["']\]/);
  assert.doesNotMatch(config, /disableJwtPlugin:\s*true/);
});

test('Google sign-in requires a verified provider email and reads credentials only from Worker bindings', async () => {
  const config = await source('../src/auth-options.ts');
  assert.match(config, /requireEmailVerification:\s*true/);
  assert.match(config, /env\.GOOGLE_CLIENT_ID/);
  assert.match(config, /env\.GOOGLE_CLIENT_SECRET/);
  assert.doesNotMatch(config, /VITE_GOOGLE|VITE_BETTER_AUTH|localStorage/);
});

test('auth Worker rejects foreign browser origins and does not share auth cookies with the app parent domain', async () => {
  const worker = await source('../src/index.ts');
  const config = await source('../src/auth-options.ts');
  assert.match(worker, /origin !== env\.APP_ORIGIN/);
  assert.match(worker, /Access-Control-Allow-Credentials/);
  assert.match(worker, /Vary.*Origin/s);
  assert.match(config, /defaultCookieAttributes/);
  assert.doesNotMatch(config, /domain:\s*["']\.sykabelajar\.my\.id["']/);
});

test('local Worker config does not bind to a production D1 database or deploy on push', async () => {
  const wrangler = await source('../wrangler.jsonc');
  const workflow = await source('../../../.github/workflows/auth-worker-poc.yml');
  assert.match(wrangler, /"database_name":\s*["']sykabelajar-auth-local["']/);
  assert.match(wrangler, /"database_id":\s*["']00000000-0000-0000-0000-000000000000["']/);
  assert.match(workflow, /npm run build:worker/);
  assert.doesNotMatch(workflow, /wrangler deploy\s*$/m);
});

test('the auth Worker exposes no privileged bootstrap endpoint in its public HTTP surface', async () => {
  const worker = await source('../src/index.ts');
  assert.match(worker, /\/api\/auth/);
  assert.match(worker, /\/healthz/);
  assert.doesNotMatch(worker, /service_role|SUPABASE_SERVICE_ROLE|adminCreateOAuthClient/);
});
