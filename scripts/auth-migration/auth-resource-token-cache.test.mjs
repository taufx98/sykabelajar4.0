import assert from "node:assert/strict";
import test from "node:test";
import { createAuthResourceTokenCache } from "../../src/services/authResourceTokenCache.mjs";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("same-user resource token is reused in memory until refresh margin", async () => {
  let now = 1_000_000;
  let exchanges = 0;
  const cache = createAuthResourceTokenCache({
    refreshMarginMs: 45_000,
    now: () => now,
  });
  cache.setActiveUserId(USER_A);

  const first = await cache.getOrCreate(USER_A, async () => {
    exchanges += 1;
    return { token: "resource-token-a1", expiresAt: now + 120_000 };
  });
  const cached = cache.getCachedToken(USER_A);
  assert.equal(first, "resource-token-a1");
  assert.equal(cached, first);

  const reused = await cache.getOrCreate(USER_A, async () => {
    exchanges += 1;
    return { token: "unexpected-second-token", expiresAt: now + 120_000 };
  });
  assert.equal(reused, first);
  assert.equal(exchanges, 1, "a valid token must not trigger another Worker/D1 exchange");

  now += 80_000;
  assert.equal(cache.getCachedToken(USER_A), null, "token enters refresh window");
  const refreshed = await cache.getOrCreate(USER_A, async () => {
    exchanges += 1;
    return { token: "resource-token-a2", expiresAt: now + 180_000 };
  });
  assert.equal(refreshed, "resource-token-a2");
  assert.equal(exchanges, 2);
});

test("concurrent requests for one identity share a single PKCE token exchange", async () => {
  const cache = createAuthResourceTokenCache({ refreshMarginMs: 0 });
  cache.setActiveUserId(USER_A);
  let exchanges = 0;
  let resolveExchange;
  const exchange = new Promise((resolve) => { resolveExchange = resolve; });
  const createToken = async () => {
    exchanges += 1;
    return exchange;
  };

  const first = cache.getOrCreate(USER_A, createToken);
  const second = cache.getOrCreate(USER_A, createToken);
  await Promise.resolve();
  assert.equal(exchanges, 1);
  resolveExchange({ token: "shared-resource-token", expiresAt: Date.now() + 120_000 });
  assert.deepEqual(await Promise.all([first, second]), [
    "shared-resource-token",
    "shared-resource-token",
  ]);
  assert.equal(exchanges, 1);
});

test("account switch invalidates the old cached token and rejects its in-flight exchange", async () => {
  const cache = createAuthResourceTokenCache({ refreshMarginMs: 0 });
  cache.setActiveUserId(USER_A);
  let resolveExchange;
  const exchange = new Promise((resolve) => { resolveExchange = resolve; });
  const pending = cache.getOrCreate(USER_A, () => exchange);

  cache.setActiveUserId(USER_B);
  resolveExchange({ token: "stale-user-a-token", expiresAt: Date.now() + 120_000 });
  await assert.rejects(pending, /AUTH_RESOURCE_TOKEN_SESSION_CHANGED/);
  assert.equal(cache.getCachedToken(USER_A), null);
  assert.equal(cache.getCachedToken(USER_B), null);
  assert.equal(cache.getActiveUserId(), USER_B);
});

test("logout clears cached and in-flight resource tokens", async () => {
  const cache = createAuthResourceTokenCache({ refreshMarginMs: 0 });
  cache.setActiveUserId(USER_A);
  const cached = await cache.getOrCreate(USER_A, async () => ({
    token: "logged-in-token",
    expiresAt: Date.now() + 120_000,
  }));
  assert.equal(cached, "logged-in-token");

  cache.setActiveUserId(null);
  assert.equal(cache.getCachedToken(USER_A), null);
  assert.equal(cache.getActiveUserId(), null);
  await assert.rejects(
    cache.getOrCreate(USER_A, async () => ({
      token: "must-not-issue",
      expiresAt: Date.now() + 120_000,
    })),
    /AUTH_RESOURCE_TOKEN_SESSION_CHANGED/,
  );
});

test("explicit clear invalidates a token exchange without changing the current identity", async () => {
  const cache = createAuthResourceTokenCache({ refreshMarginMs: 0 });
  cache.setActiveUserId(USER_A);
  let resolveExchange;
  const exchange = new Promise((resolve) => { resolveExchange = resolve; });
  const pending = cache.getOrCreate(USER_A, () => exchange);
  cache.clear();
  resolveExchange({ token: "stale-after-clear", expiresAt: Date.now() + 120_000 });
  await assert.rejects(pending, /AUTH_RESOURCE_TOKEN_SESSION_CHANGED/);
  assert.equal(cache.getActiveUserId(), USER_A);
  assert.equal(cache.getCachedToken(USER_A), null);
});

test("tokens that arrive too close to expiry are never cached", async () => {
  const now = Date.now();
  const cache = createAuthResourceTokenCache({ refreshMarginMs: 45_000, now: () => now });
  cache.setActiveUserId(USER_A);
  await assert.rejects(
    cache.getOrCreate(USER_A, async () => ({
      token: "almost-expired",
      expiresAt: now + 10_000,
    })),
    /AUTH_RESOURCE_TOKEN_RESULT_INVALID/,
  );
  assert.equal(cache.getCachedToken(USER_A), null);
});

console.log("Better Auth in-memory resource token cache contract passed.");
