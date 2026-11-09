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
  assert.match(appContext, /authUserRef\.current\?\.id === userId/);
  assert.match(appContext, /authHydrationGateRef\.current\?\.invalidate\(\)/);
  assert.match(appContext, /authUserRef\.current = next/);
  assert.match(appContext, /const isHydrationCurrent = \(\) =>/);
  assert.match(appContext, /if \(!isHydrationCurrent\(\)\) return;\s*throw error;/);
  assert.match(appContext, /if \(!profile\) \{\s*if \(!isHydrationCurrent\(\)\) return;\s*throw new Error\('PROFILE_NOT_FOUND'\);/);
});

test("refreshUser and updateProfile reject stale same-UUID hydration results", () => {
  const appContext = readFileSync(
    new URL("../../src/store/AppContext.tsx", import.meta.url),
    "utf8",
  );
  const refreshStart = appContext.indexOf("const refreshUser = useCallback");
  const updateStart = appContext.indexOf("const updateProfile = useCallback", refreshStart);
  const nextActionStart = appContext.indexOf("const markNotificationRead = useCallback", updateStart);
  assert.ok(refreshStart >= 0 && updateStart > refreshStart && nextActionStart > updateStart);

  const refreshUser = appContext.slice(refreshStart, updateStart);
  const updateProfile = appContext.slice(updateStart, nextActionStart);
  for (const source of [refreshUser, updateProfile]) {
    assert.match(source, /authHydrationGateRef\.current!\.begin\(\)/);
    assert.match(source, /authHydrationGateRef\.current\?\.isCurrent\(hydrationRequest\)/);
    assert.match(source, /authUserRef\.current\?\.id === current\.id/);
    assert.match(source, /await getUserRoles\(current\.id\);\s*if \(!isHydrationCurrent\(\)\) return;/);
    assert.match(source, /if \(!isHydrationCurrent\(\)\) return;[\s\S]*setUser\(/);
  }
});

test("AppContext bootstrap cannot restore a session after a newer auth event or guest transition", () => {
  const appContext = readFileSync(
    new URL("../../src/store/AppContext.tsx", import.meta.url),
    "utf8",
  );
  const bootstrapStart = appContext.indexOf("const bootstrapGeneration =");
  const listenerStart = appContext.indexOf("onAuthStateChange((event, session)", bootstrapStart);
  const awardsStart = appContext.indexOf("// Awards are secondary to authentication.", listenerStart);
  assert.ok(bootstrapStart >= 0 && listenerStart > bootstrapStart && awardsStart > listenerStart);

  const bootstrap = appContext.slice(bootstrapStart, listenerStart);
  const listener = appContext.slice(listenerStart, awardsStart);
  assert.match(bootstrap, /authBootstrapGenerationRef\.current === bootstrapGeneration/);
  assert.match(bootstrap, /await getAuthSession\(\);[\s\S]*if \(!isBootstrapCurrent\(\)\) return;/);
  assert.match(bootstrap, /if \(isBootstrapCurrent\(\)\) clearUserState\(\)/);
  assert.match(listener, /authBootstrapGenerationRef\.current \+= 1;[\s\S]*authHydrationGateRef\.current\?\.invalidate\(\);[\s\S]*publishAuthSessionEvent/);
  assert.match(appContext, /const clearUserState = useCallback\(\(\) => \{\s*authBootstrapGenerationRef\.current \+= 1;/);
  assert.match(listener, /window\.setTimeout\(hydrateFromCurrentEvent, 0\)/);
  assert.match(listener, /const authEventGeneration = \+\+authBootstrapGenerationRef\.current/);
  assert.match(listener, /authBootstrapGenerationRef\.current !== authEventGeneration/);
  assert.match(listener, /const hydrationRequest = authHydrationGateRef\.current!\.begin\(\)/);
  assert.match(listener, /hydrateCurrentUser\(uid, email, undefined, hydrationRequest\)/);
  assert.match(listener, /authHydrationGateRef\.current\?\.isCurrent\(hydrationRequest\) === true/);
  assert.match(listener, /if \(isCurrentEvent\(\)\) clearUserState\(\)/);
});
console.log("Auth hydration gate contract passed: stale requests cannot overwrite a newer session.");
