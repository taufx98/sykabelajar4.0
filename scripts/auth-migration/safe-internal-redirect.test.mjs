import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveSafeInternalRedirect } from "../../src/lib/safeInternalRedirect.mjs";

const ORIGIN = "https://staging.sykabelajar.my.id";

test("preserves safe same-origin application paths, query strings and fragments", () => {
  assert.equal(resolveSafeInternalRedirect("/home", ORIGIN), "/home");
  assert.equal(resolveSafeInternalRedirect("/lomba/aktif?page=2#hasil", ORIGIN), "/lomba/aktif?page=2#hasil");
});

test("rejects external and protocol-relative redirects", () => {
  for (const value of [
    "//evil.example/path",
    "https://evil.example/path",
    "http://evil.example/path",
    "javascript:alert(1)",
    "data:text/html,evil",
    "evil.example/path",
    "",
    null,
    undefined,
  ]) {
    assert.equal(resolveSafeInternalRedirect(value, ORIGIN), "/home", String(value));
  }
});

test("rejects browser-normalized backslash authority redirects", () => {
  for (const value of [
    "/\\\\evil.example/path",
    "/\\evil.example/path",
    "/\\@evil.example/path",
  ]) {
    assert.equal(resolveSafeInternalRedirect(value, ORIGIN), "/home", JSON.stringify(value));
  }
});

test("does not trust malformed or non-web application origins", () => {
  assert.equal(resolveSafeInternalRedirect("/home", "not a URL"), "/home");
  assert.equal(resolveSafeInternalRedirect("/home", "javascript:alert(1)"), "/home");
});


test("login, registration and OAuth service all use the same-origin redirect guard", () => {
  const login = readFileSync(new URL("../../src/pages/LoginPage.tsx", import.meta.url), "utf8");
  const registration = readFileSync(new URL("../../src/pages/RegisterPage.tsx", import.meta.url), "utf8");
  const authService = readFileSync(new URL("../../src/services/auth.service.ts", import.meta.url), "utf8");

  assert.match(login, /resolveSafeInternalRedirect\(requestedRedirect, window\.location\.origin\)/);
  assert.match(registration, /resolveSafeInternalRedirect\(requestedRedirect, window\.location\.origin\)/);
  assert.match(authService, /resolveSafeInternalRedirect\(callbackURL, window\.location\.origin\)/);
  assert.match(authService, /new URL\(safeCallbackPath, window\.location\.origin\)/);
});
