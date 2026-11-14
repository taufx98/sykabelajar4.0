import assert from "node:assert/strict";
import { resolveSupabaseEnvironment } from "../../src/lib/supabaseEnvironment.mjs";

const productionEnv = {
  VITE_SUPABASE_URL: "https://mvdczyitbkxkldjughor.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_production_key",
};
const stagingEnv = {
  ...productionEnv,
  VITE_BETTER_AUTH_SUPABASE_URL: "https://ydamszdfsxqisanazdkb.supabase.co",
  VITE_BETTER_AUTH_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staging_key",
};

const staging = resolveSupabaseEnvironment("staging.sykabelajar.my.id", stagingEnv);
assert.deepEqual(staging, {
  supabaseUrl: "https://ydamszdfsxqisanazdkb.supabase.co",
  supabasePublishableKey: "sb_publishable_staging_key",
  isBetterAuthStaging: true,
});

for (const hostname of [
  "security-auth-poc-stage-1.sykabelajar4.pages.dev",
  "feature-preview.sykabelajar4.pages.dev",
  "sykabelajar.my.id",
  "www.sykabelajar.my.id",
  "localhost",
]) {
  const selected = resolveSupabaseEnvironment(hostname, stagingEnv);
  assert.equal(selected.supabaseUrl, productionEnv.VITE_SUPABASE_URL, hostname);
  assert.equal(selected.supabasePublishableKey, productionEnv.VITE_SUPABASE_PUBLISHABLE_KEY, hostname);
  assert.equal(selected.isBetterAuthStaging, false, hostname);
}

assert.throws(
  () => resolveSupabaseEnvironment("staging.sykabelajar.my.id", productionEnv),
  /VITE_BETTER_AUTH_SUPABASE_URL/,
  "the staging hostname must fail closed rather than fall back to the production Supabase project",
);
assert.throws(
  () => resolveSupabaseEnvironment("staging.sykabelajar.my.id", {
    ...stagingEnv,
    VITE_BETTER_AUTH_SUPABASE_URL: productionEnv.VITE_SUPABASE_URL,
  }),
  /not allowed for this runtime/,
);
assert.throws(
  () => resolveSupabaseEnvironment("staging.sykabelajar.my.id", {
    ...stagingEnv,
    VITE_BETTER_AUTH_SUPABASE_PUBLISHABLE_KEY: "legacy_anon_key",
  }),
  /modern Supabase publishable key/,
);

console.log("Supabase environment selection contract passed: only exact staging hostname uses isolated project; all other hosts preserve existing Supabase environment.");
