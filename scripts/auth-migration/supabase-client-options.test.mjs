import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseClientOptions } from "../../src/services/supabaseClientOptions.mjs";

const fetchImpl = async () => new Response(null, { status: 204 });

test("Supabase Auth remains unchanged when Better Auth is not explicitly selected", () => {
  const options = createSupabaseClientOptions({
    useExternalAuth: false,
    fetchImpl,
  });

  assert.deepEqual(options.auth, {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  });
  assert.equal(options.global.fetch, fetchImpl);
  assert.equal("accessToken" in options, false);
});

test("Better Auth supplies one short-lived resource token source to every Supabase API", async () => {
  const getExternalAccessToken = async () => "short-lived-better-auth-jwt";
  const options = createSupabaseClientOptions({
    useExternalAuth: true,
    getExternalAccessToken,
    fetchImpl,
  });

  assert.deepEqual(options.auth, {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  });
  assert.equal(options.global.fetch, fetchImpl);
  assert.equal(options.accessToken, getExternalAccessToken);
  assert.equal(await options.accessToken(), "short-lived-better-auth-jwt");
});

test("external token mode fails closed when its provider is not configured", () => {
  assert.throws(
    () => createSupabaseClientOptions({ useExternalAuth: true, fetchImpl }),
    /SUPABASE_EXTERNAL_ACCESS_TOKEN_PROVIDER_REQUIRED/,
  );
});

console.log("Supabase shared-client token-source contract passed.");
