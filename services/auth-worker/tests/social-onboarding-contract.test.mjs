import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  needsInitialProfileCompletion,
  validateInitialProfile,
} from "../../../src/lib/profileOnboarding.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../../../src/App.tsx");
const register = read("../../../src/pages/RegisterPage.tsx");
const page = read("../../../src/pages/AuthSocialOnboardingPage.tsx");
const service = read("../../../src/services/profileOnboarding.service.ts");
const migration = read("../../../supabase/migrations/20261116095715_better_auth_profile_onboarding.sql");

test("only profiles without a username are marked for initial onboarding", () => {
  assert.equal(needsInitialProfileCompletion({ username: "" }), true);
  assert.equal(needsInitialProfileCompletion({ username: null }), true);
  assert.equal(needsInitialProfileCompletion({ username: "pelajar_01" }), false);
  assert.equal(needsInitialProfileCompletion(null), false);
});

test("onboarding validation requires every initial student profile field", () => {
  const valid = {
    username: "pelajar.01",
    fullName: "Nama Pelajar",
    birthDate: "2009-04-12",
    institution: "SMP Contoh",
    grade: "smp",
    subjects: ["mtk", "ipa"],
  };
  assert.equal(validateInitialProfile(valid), null);
  assert.equal(validateInitialProfile({ ...valid, username: "bad name" }), "USERNAME_INVALID");
  assert.equal(validateInitialProfile({ ...valid, birthDate: "2099-01-01" }), "BIRTH_DATE_INVALID");
  assert.equal(validateInitialProfile({ ...valid, subjects: [] }), "FAVORITE_CATEGORIES_REQUIRED");
});

test("social signup returns to profile onboarding and protected app routes enforce the same gate", () => {
  assert.match(register, /signInWithSocial\(provider,'\/auth\/complete-profile\?redirect='/);
  assert.match(app, /InitialProfileCompletionGuard/);
  assert.match(app, /path="\/auth\/complete-profile"/);
  assert.match(page, /completeBetterAuthProfile/);
  assert.match(page, /Simpan & masuk ke Home/);
});

test("profile completion writes only through the narrow Better Auth RPC", () => {
  assert.match(service, /supabase\.rpc\('complete_better_auth_profile'/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /auth\.jwt\(\) ->> 'iss'/);
  assert.match(migration, /email_verified_at/);
  assert.match(migration, /identity_origin = 'better_auth'/);
  assert.match(migration, /USERNAME_ALREADY_TAKEN/);
  assert.match(migration, /username = v_username/);
  assert.doesNotMatch(migration, /account_type\s*=/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.user_roles/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.complete_better_auth_profile/);
});
