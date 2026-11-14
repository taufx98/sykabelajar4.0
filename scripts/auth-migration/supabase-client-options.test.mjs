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

test("Better Auth token callback stays live across repeated Supabase requests and logout", async () => {
  const issued = [
    "better-auth-user-a-token-v1",
    "better-auth-user-a-token-v2",
    null,
  ];
  let reads = 0;
  const getExternalAccessToken = async () => issued[reads++] ?? null;
  const options = createSupabaseClientOptions({
    useExternalAuth: true,
    getExternalAccessToken,
    fetchImpl,
  });

  // Supabase may ask the shared callback again when a Realtime connection
  // starts or renews. The callback must obtain the latest token, not capture
  // a stale token string when the client was constructed.
  assert.equal(await options.accessToken(), "better-auth-user-a-token-v1");
  assert.equal(await options.accessToken(), "better-auth-user-a-token-v2");

  // After sign-out, the same callback must no longer return the previous
  // user's access token to Data API, Storage, or Realtime requests.
  assert.equal(await options.accessToken(), null);
  assert.equal(reads, 3);
});

test("external token mode fails closed when its provider is not configured", () => {
  assert.throws(
    () => createSupabaseClientOptions({ useExternalAuth: true, fetchImpl }),
    /SUPABASE_EXTERNAL_ACCESS_TOKEN_PROVIDER_REQUIRED/,
  );
});

console.log("Supabase shared-client token-source contract passed.");
