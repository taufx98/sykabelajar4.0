import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/persistentCache.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function loadCacheModule(now = 1_000_000) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  let clock = now;
  class FakeDate extends Date {
    static now() { return clock; }
  }
  const exports = {};
  vm.runInNewContext(compiled, { exports, localStorage: storage, Date: FakeDate, Object, Number, JSON });
  return { api: exports, storage, values, advance: (ms) => { clock += ms; } };
}

test('fresh-only reads reject expired entries while stale-aware reads retain them during grace', () => {
  const { api, advance } = loadCacheModule();
  api.setPersistentCache('sample', { value: 42 }, { ttlMs: 5_000 });
  assert.equal(api.getFreshPersistentCache('sample')?.data.value, 42);
  advance(5_001);
  assert.equal(api.getFreshPersistentCache('sample'), null);
  assert.equal(api.getPersistentCache('sample')?.data.value, 42);
  assert.equal(api.getPersistentCacheState('sample')?.stale, true);
});

test('stale reads never extend savedAt or expiresAt', () => {
  const { api, storage, advance } = loadCacheModule();
  const original = api.setPersistentCache('sample', { value: 42 }, { ttlMs: 5_000 });
  advance(6_000);
  api.getPersistentCache('sample');
  api.getPersistentCacheState('sample');
  const stored = JSON.parse(storage.getItem('syka.cache.v1.sample'));
  assert.equal(stored.savedAt, original.savedAt);
  assert.equal(stored.expiresAt, original.expiresAt);
});

test('entries are removed after one additional original TTL of stale grace', () => {
  const { api, storage, advance } = loadCacheModule();
  api.setPersistentCache('sample', { value: 42 }, { ttlMs: 5_000 });
  advance(9_999);
  assert.equal(api.getPersistentCacheState('sample')?.stale, true);
  advance(1);
  assert.equal(api.getPersistentCache('sample'), null);
  assert.equal(storage.getItem('syka.cache.v1.sample'), null);
});

test('malformed timestamps, invalid ranges, and missing data are rejected', () => {
  const { api, storage } = loadCacheModule();
  storage.setItem('syka.cache.v1.bad-time', JSON.stringify({ data: 1, savedAt: 10, expiresAt: Number.NaN }));
  storage.setItem('syka.cache.v1.bad-range', JSON.stringify({ data: 1, savedAt: 20, expiresAt: 10 }));
  storage.setItem('syka.cache.v1.missing-data', JSON.stringify({ savedAt: 10, expiresAt: 20 }));
  assert.equal(api.getPersistentCache('bad-time'), null);
  assert.equal(api.getPersistentCache('bad-range'), null);
  assert.equal(api.getPersistentCache('missing-data'), null);
});

test('entries from a different cache version are discarded', () => {
  const { api, storage } = loadCacheModule();
  api.setPersistentCache('sample', { value: 42 }, { ttlMs: 5_000, version: 'v2' });
  assert.equal(api.getPersistentCache('sample', 'v1'), null);
  assert.equal(storage.getItem('syka.cache.v1.sample'), null);
});
