import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authPath = new URL("../src/auth.ts", import.meta.url);
const envPath = new URL("../src/env.ts", import.meta.url);
const auth = readFileSync(authPath, "utf8");
const env = readFileSync(envPath, "utf8");
const settings = readFileSync(new URL("../src/social-provider-settings.ts", import.meta.url), "utf8");

test("Google, Facebook and X provider credentials are optional and validated as pairs", () => {
  for (const provider of ["GOOGLE", "FACEBOOK", "TWITTER"]) {
    assert.match(auth, new RegExp(provider + "_CLIENT_ID"));
    assert.match(auth, new RegExp(provider + "_CLIENT_SECRET"));
    assert.match(env, new RegExp(provider + "_CLIENT_ID\\?: string"));
    assert.match(env, new RegExp(provider + "_CLIENT_SECRET\\?: string"));
  }
  assert.match(auth, /Boolean\(clientId\) !== Boolean\(clientSecret\)/);
  assert.ok(auth.includes('throw new Error(provider + "_OAUTH_REQUIRES_BOTH_CLIENT_ID_AND_CLIENT_SECRET")'));
  assert.match(auth, /Object\.keys\(configuredSocialProviders\)\.length > 0/);
});


test("managed OAuth configuration falls back only when migration 0007 is absent", () => {
  assert.ok(settings.includes('if (/no such table:\\s*auth_social_provider_meta/i.test(reason)) return null;'));
  assert.ok(settings.includes('throw new Error("SOCIAL_PROVIDER_CONFIGURATION_UNAVAILABLE")'));
  assert.match(settings, /if \(!meta\) throw new Error\("SOCIAL_PROVIDER_CONFIGURATION_UNAVAILABLE"\)/);
  assert.match(settings, /managedMode: true, revision: meta\.revision, providers/);
  assert.match(settings, /AUTH_PROVIDER_ENCRYPTION_KEY/);
});

test("Facebook login requests email and rejects profiles without a usable email", () => {
  assert.match(auth, /facebook:\s*\{/);
  assert.match(auth, /scope:\s*\["email",\s*"public_profile"\]/);
  assert.match(auth, /FACEBOOK_EMAIL_REQUIRED/);
  assert.match(auth, /profile\.email\.trim\(\)/);
  const facebookBlock = auth.slice(auth.indexOf("facebook:"), auth.indexOf("twitter:"));
  assert.doesNotMatch(facebookBlock, /requireEmailVerification/);
  assert.match(auth, /EMAIL_VERIFICATION_REQUIRED/);
  assert.match(auth, /user\.emailVerified !== true/);
});

test("X login uses the built-in Twitter provider and verified-email gate", () => {
  assert.match(auth, /twitter:\s*\{/);
  assert.match(auth, /requireEmailVerification:\s*true/);
  // Better Auth 1.7.16's built-in Twitter provider requests users.email and
  // maps X's confirmed_email response to emailVerified=true.
  assert.match(auth, /Better Auth 1\.7\.16 requests users\.email by default/);
  assert.match(auth, /TWITTER_CONFIRMED_EMAIL_REQUIRED/);
  assert.match(auth, /profile\.data\.email\.trim\(\)/);
});

test("all password and social sessions are blocked until SYKABELAJAR email verification", () => {
  const hookStart = auth.indexOf("session: {");
  const hook = auth.slice(hookStart, auth.indexOf("account: {", hookStart));
  assert.match(hook, /user\.emailVerified !== true/);
  assert.match(hook, /EMAIL_VERIFICATION_REQUIRED/);
  assert.match(auth, /sendOnSignUp: true/);
  assert.match(auth, /autoSignInAfterVerification: true/);
});


test("Facebook is runtime-filtered and cannot be enabled without the deferred email path", () => {
  const email = readFileSync(new URL("../src/email.ts", import.meta.url), "utf8");
  const delivery = readFileSync(new URL("../src/email-delivery.mjs", import.meta.url), "utf8");
  assert.match(email, /export async function isAuthEmailVerificationConfigured/);
  assert.match(email, /if \(providerMode === "webhook"\) return isEmailDeliveryConfigured\(env\)/);
  assert.match(email, /providerMode !== "managed"/);
  assert.match(email, /decryptEmailSecret\(/);
  const readiness = email.slice(email.indexOf("export async function isAuthEmailVerificationConfigured"), email.indexOf("export async function sendAuthEmail"));
  assert.doesNotMatch(readiness, /sendAuthEmail\(|deliverAuthEmail\(/,
    "checking readiness must not send a verification email");
  assert.match(settings, /safeProviders\.facebook && !\(await isAuthEmailVerificationConfigured\(env\)\)/);
  assert.match(settings, /SOCIAL_PROVIDER_EMAIL_VERIFICATION_REQUIRED/);
  assert.match(settings, /emailVerificationConfigured/);
  assert.match(delivery, /export function isEmailDeliveryConfigured/);
});

test("Telegram phone verification is not registered as a social login provider", () => {
  const socialBlock = auth.slice(auth.indexOf("const configuredSocialProviders"), auth.indexOf("return betterAuth"));
  assert.doesNotMatch(socialBlock, /telegram/i);
});

test("the Admin settings GET is authenticated and returns credential metadata only", () => {
  const start = settings.indexOf("async function listAdminSettings");
  const end = settings.indexOf("async function seedEnvironmentProviders", start);
  assert.ok(start >= 0 && end > start, "the admin settings projection must be present");
  const projection = settings.slice(start, end);

  assert.match(settings, /export async function handleLoginProviderAdminRequest/);
  const handlerStart = settings.indexOf("export async function handleLoginProviderAdminRequest");
  const handler = settings.slice(handlerStart);
  assert.match(handler, /const authorization = await requireBetterAuthAdmin\(request, env\)/);
  assert.ok(handler.indexOf("requireBetterAuthAdmin(request, env)") < handler.indexOf("if (request.method === \"GET\")"),
    "GET must pass the Better Auth admin check before returning settings");

  for (const field of ["provider", "primary", "enabled", "clientId", "secretConfigured", "source", "callbackUrl", "status", "updatedAt"]) {
    assert.match(projection, new RegExp("\\b" + field + "\\b"));
  }
  assert.match(projection, /instagram:\s*\{\s*available:\s*false/);
  assert.doesNotMatch(projection, /clientSecret\s*:/,
    "GET must never return a plaintext clientSecret property");
  assert.doesNotMatch(projection, /client_secret_ciphertext\s*:/,
    "GET must never return a ciphertext property");
  assert.doesNotMatch(projection, /\.\.\.row|JSON\.stringify\(row\)/,
    "GET must not serialize a D1 credential row wholesale");
});

test("saving OAuth credentials encrypts the secret before the D1 write", () => {
  const start = settings.indexOf("async function saveProvider");
  const end = settings.indexOf("async function setProviderEnabled", start);
  assert.ok(start >= 0 && end > start);
  const save = settings.slice(start, end);
  assert.match(save, /let ciphertext = existing\?\.client_secret_ciphertext \?\? ""/);
  assert.match(save, /if \(suppliedSecret\)[\s\S]*?ciphertext = await encryptSocialProviderSecret\(key, suppliedSecret\)/);
  assert.match(save, /client_secret_ciphertext/);
  assert.match(save, /\.bind\(provider, clientId, ciphertext, enabled \? 1 : 0, user\.id\)/);
  assert.doesNotMatch(save, /\.bind\([^;]*suppliedSecret/);
  const encryption = save.indexOf("ciphertext = await encryptSocialProviderSecret(key, suppliedSecret)");
  const write = save.indexOf("env.DB.batch([", encryption);
  assert.ok(encryption >= 0 && write > encryption, "new secrets must be encrypted before D1 writes");
  assert.match(save, /SOCIAL_PROVIDER_CLIENT_SECRET_INVALID/);
});

test("provider toggles fail closed when encryption, verification or the last login method is unsafe", () => {
  const start = settings.indexOf("async function setProviderEnabled");
  const end = settings.indexOf("async function validateProvider", start);
  assert.ok(start >= 0 && end > start);
  const toggle = settings.slice(start, end);
  assert.match(toggle, /AUTH_PROVIDER_ENCRYPTION_KEY\.length < 32/);
  assert.match(toggle, /provider === "facebook" && !emailVerificationConfigured/);
  assert.match(toggle, /SOCIAL_PROVIDER_EMAIL_VERIFICATION_REQUIRED/);
  assert.match(toggle, /decryptSocialProviderSecret\(/);
  assert.match(toggle, /usableRows\.length <= 1/);
  assert.match(toggle, /SOCIAL_PROVIDER_LAST_ENABLED_METHOD/);
});


test("Better Auth admin role checks use the caller JWT and staging publishable key, never service-role credentials", () => {
  const emailAdmin = readFileSync(new URL("../src/email-admin.ts", import.meta.url), "utf8");
  const adminVerifier = readFileSync(new URL("../src/email-admin-auth.mjs", import.meta.url), "utf8");
  assert.match(settings, /publishableKey: env\.SUPABASE_PROVISIONING_PUBLISHABLE_KEY/);
  assert.match(emailAdmin, /publishableKey: env\.SUPABASE_PROVISIONING_PUBLISHABLE_KEY/);
  assert.match(adminVerifier, /apikey: publishableKey/);
  assert.match(adminVerifier, /Authorization: "Bearer " \+ accessToken/);
  assert.doesNotMatch(settings + emailAdmin, /serviceRoleKey: env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(adminVerifier, /serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY/);
});
