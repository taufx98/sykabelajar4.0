import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createAuthHydrationGate } from "../../src/services/authHydrationGate.mjs";

test("only the latest in-flight profile/role hydration may publish", () => {
  const gate = createAuthHydrationGate();
  const olderRequest = gate.begin();
  const newerRequest = gate.begin();

  assert.equal(gate.isCurrent(olderRequest), false);
  assert.equal(gate.isCurrent(newerRequest), true);
});

test("logout or account replacement invalidates work that has not returned yet", () => {
  const gate = createAuthHydrationGate();
  const pendingRequest = gate.begin();

  gate.invalidate();

  assert.equal(gate.isCurrent(pendingRequest), false);
});

test("a new login for the same UUID still invalidates the previous hydration generation", () => {
  const gate = createAuthHydrationGate();
  const firstLogin = gate.begin();

  gate.invalidate();
  const secondLogin = gate.begin();

  assert.equal(gate.isCurrent(firstLogin), false);
  assert.equal(gate.isCurrent(secondLogin), true);
});

test("AppContext checks both request generation and current identity before publishing", () => {
  const appContext = readFileSync(
    new URL("../../src/store/AppContext.tsx", import.meta.url),
    "utf8",
  );

  assert.match(appContext, /createAuthHydrationGate/);
  assert.match(appContext, /authHydrationGateRef\.current!\.begin\(\)/);
  assert.match(appContext, /authHydrationGateRef\.current\?\.isCurrent\(hydrationRequest\)/);
  assert.match(appContext, /authUserRef\.current\?\.id !== userId/);
  assert.match(appContext, /authHydrationGateRef\.current\?\.invalidate\(\)/);
  assert.match(appContext, /authUserRef\.current = next/);
  assert.match(appContext, /const isHydrationCurrent = \(\) =>/);
  assert.match(appContext, /catch \(error\) \{\s*if \(!isHydrationCurrent\(\)\) return;\s*throw error;\s*\}/);
  assert.match(appContext, /if \(!profile\) \{\s*if \(!isHydrationCurrent\(\)\) return;\s*throw new Error\('PROFILE_NOT_FOUND'\);/);
});

console.log("Auth hydration gate contract passed: stale requests cannot overwrite a newer session.");
