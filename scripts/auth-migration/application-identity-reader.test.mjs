import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationIdentityReader } from "../../src/services/applicationIdentityReader.mjs";

test("uses the shared UUID snapshot without an additional provider session request", async () => {
  let fallbackCalls = 0;
  const read = createApplicationIdentityReader({
    getSnapshot: () => ({ initialized: true, userId: "  11111111-1111-4111-8111-111111111111  " }),
    getFallbackUserId: async () => {
      fallbackCalls += 1;
      return "22222222-2222-4222-8222-222222222222";
    },
  });

  assert.equal(await read(), "11111111-1111-4111-8111-111111111111");
  assert.equal(fallbackCalls, 0);
});

test("an initialized signed-out snapshot does not resurrect a stale provider session", async () => {
  let fallbackCalls = 0;
  const read = createApplicationIdentityReader({
    getSnapshot: () => ({ initialized: true, userId: null }),
    getFallbackUserId: async () => {
      fallbackCalls += 1;
      return "22222222-2222-4222-8222-222222222222";
    },
  });

  assert.equal(await read(), null);
  assert.equal(fallbackCalls, 0);
});

test("falls back to the active auth provider only before initial session publication", async () => {
  let fallbackCalls = 0;
  const read = createApplicationIdentityReader({
    getSnapshot: () => null,
    getFallbackUserId: async () => {
      fallbackCalls += 1;
      return "33333333-3333-4333-8333-333333333333";
    },
  });

  assert.equal(await read(), "33333333-3333-4333-8333-333333333333");
  assert.equal(fallbackCalls, 1);
});

test("a signed-out bootstrap and provider errors remain fail-closed", async () => {
  const signedOut = createApplicationIdentityReader({
    getSnapshot: () => undefined,
    getFallbackUserId: async () => null,
  });
  assert.equal(await signedOut(), null);

  const unavailable = createApplicationIdentityReader({
    getSnapshot: () => null,
    getFallbackUserId: async () => { throw new Error("AUTH_PROVIDER_UNAVAILABLE"); },
  });
  await assert.rejects(unavailable(), /AUTH_PROVIDER_UNAVAILABLE/);
});

console.log("Application identity reader contract passed: authoritative bus snapshot, no stale-session resurrection, bootstrap-only fallback.");
