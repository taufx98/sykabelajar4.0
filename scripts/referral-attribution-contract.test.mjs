import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/referralAttribution.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
const { isValidReferralId, storePendingReferral, getPendingReferral, clearPendingReferral } = await import(moduleUrl);
const validId = '123e4567-e89b-42d3-a456-426614174000';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('accepts canonical account UUID and rejects malformed referral values', () => {
  assert.equal(isValidReferralId(validId), true);
  assert.equal(isValidReferralId('not-a-uuid'), false);
  assert.equal(isValidReferralId(''), false);
  assert.equal(isValidReferralId(null), false);
});

test('stores a valid referral and makes it available to the next competition registration', () => {
  const storage = memoryStorage();
  assert.equal(storePendingReferral(validId, storage), true);
  assert.equal(getPendingReferral(storage), validId);
});

test('does not overwrite a valid pending referral with an invalid value', () => {
  const storage = memoryStorage();
  storePendingReferral(validId, storage);
  assert.equal(storePendingReferral('invalid', storage), false);
  assert.equal(getPendingReferral(storage), validId);
});

test('clears attribution only after successful registration flow', () => {
  const storage = memoryStorage();
  storePendingReferral(validId, storage);
  clearPendingReferral(storage);
  assert.equal(getPendingReferral(storage), null);
});
