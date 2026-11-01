import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const helperSource = await readFile(new URL('../src/lib/referralAttribution.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
const { isValidReferralId } = await import(moduleUrl);
const validId = '123e4567-e89b-42d3-a456-426614174000';

test('accepts canonical UUID referral IDs and rejects malformed values', () => {
  assert.equal(isValidReferralId(validId), true);
  assert.equal(isValidReferralId('not-a-uuid'), false);
  assert.equal(isValidReferralId(''), false);
  assert.equal(isValidReferralId(null), false);
});

test('signup referral is carried as auth user metadata and handled by a database trigger', async () => {
  const appContext = await readFile(new URL('../src/store/AppContext.tsx', import.meta.url), 'utf8');
  const authService = await readFile(new URL('../src/services/auth.service.ts', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20261101043516_referral_signup_attribution.sql', import.meta.url), 'utf8');
  assert.match(appContext, /referral_id:\s*data\.referralCode/);
  assert.match(authService, /referral_id\?:\s*string/);
  assert.match(migration, /AFTER INSERT ON auth\.users/);
  assert.match(migration, /NEW\.raw_user_meta_data\s*->>\s*'referral_id'/);
  assert.match(migration, /ON CONFLICT \(referred_user_id\) DO NOTHING/);
  assert.match(migration, /email_confirmed_at IS NOT NULL/);
});
