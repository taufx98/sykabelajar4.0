import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authPath = new URL("../src/auth.ts", import.meta.url);
const envPath = new URL("../src/env.ts", import.meta.url);
const auth = readFileSync(authPath, "utf8");
const env = readFileSync(envPath, "utf8");

test("Google, Facebook and X provider credentials are optional and validated as pairs", () => {
  for (const provider of ["GOOGLE", "FACEBOOK", "TWITTER"]) {
    assert.match(auth, new RegExp(provider + "_CLIENT_ID"));
    assert.match(auth, new RegExp(provider + "_CLIENT_SECRET"));
    assert.match(env, new RegExp(provider + "_CLIENT_ID\\?: string"));
    assert.match(env, new RegExp(provider + "_CLIENT_SECRET\\?: string"));
  }
  assert.match(auth, /Boolean\(clientId\) !== Boolean\(clientSecret\)/);
  for (const provider of ["GOOGLE", "FACEBOOK", "TWITTER"]) {
    assert.match(auth, new RegExp('provider + "_OAUTH_REQUIRES_BOTH_CLIENT_ID_AND_CLIENT_SECRET"'));
  }
  assert.match(auth, /Object\.keys\(configuredSocialProviders\)\.length > 0/);
});

test("Facebook login requests basic profile/email and requires SYKABELAJAR email verification", () => {
  assert.match(auth, /facebook:\s*\{/);
  assert.match(auth, /scope:\s*\["email",\s*"public_profile"\]/);
  assert.match(auth, /requireEmailVerification:\s*true/);
});

test("X login uses the built-in Twitter provider and verified-email gate", () => {
  assert.match(auth, /twitter:\s*\{/);
  assert.match(auth, /requireEmailVerification:\s*true/);
  // Better Auth 1.7.16's built-in Twitter provider requests users.email and
  // maps X's confirmed_email response to emailVerified=true.
  assert.match(auth, /Better Auth 1\.7\.16 requests users\.email by default/);
});

test("Telegram phone verification is not registered as a social login provider", () => {
  const socialBlock = auth.slice(auth.indexOf("const configuredSocialProviders"), auth.indexOf("return betterAuth"));
  assert.doesNotMatch(socialBlock, /telegram/i);
});
