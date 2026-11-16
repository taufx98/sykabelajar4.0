import assert from "node:assert/strict";
import test from "node:test";
import { shouldReloadForAuthSessionEvent } from "../../src/services/authSessionIsolation.mjs";

test("same-tab sign-in and sign-out transitions do not reload while login is in progress", () => {
  const now = 1_800_000_000_000;
  const startedAt = now - 2_000;
  assert.equal(shouldReloadForAuthSessionEvent({
    type: "SIGNED_IN",
    identityChanged: true,
    previousUserId: "previous-user",
  }, startedAt, now), false);
  assert.equal(shouldReloadForAuthSessionEvent({
    type: "SIGNED_OUT",
    identityChanged: true,
    previousUserId: "previous-user",
  }, startedAt, now), false);
});

test("cross-tab account changes still force a clean reload", () => {
  assert.equal(shouldReloadForAuthSessionEvent({
    type: "SIGNED_IN",
    identityChanged: true,
    previousUserId: "previous-user",
  }, Number.NaN), true);
});

test("normal sign-out still forces a clean reload", () => {
  assert.equal(shouldReloadForAuthSessionEvent({
    type: "SIGNED_OUT",
    identityChanged: true,
    previousUserId: "current-user",
  }, Number.NaN), true);
});

test("initial login from an anonymous state does not reload", () => {
  assert.equal(shouldReloadForAuthSessionEvent({
    type: "SIGNED_IN",
    identityChanged: true,
    previousUserId: null,
  }, Number.NaN), false);
});

test("stale login markers no longer suppress account isolation", () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldReloadForAuthSessionEvent({
    type: "SIGNED_IN",
    identityChanged: true,
    previousUserId: "previous-user",
  }, now - 120_001, now), true);
});
