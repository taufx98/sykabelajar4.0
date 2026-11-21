import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql", import.meta.url),
  "utf8",
);

function getFunction(name) {
  const marker = "CREATE OR REPLACE FUNCTION " + name + "(";
  const start = sql.lastIndexOf(marker);
  assert.notEqual(start, -1, "missing issuer-guard replacement for " + name);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, "missing dollar-quoted function terminator for " + name);
  return sql.slice(start, end + "$function$;".length);
}

test("individual linear exam access rejects legacy Supabase Auth before reading attempt data", () => {
  const body = getFunction("private.assert_individual_linear_exam_access");
  assert.match(body, /RETURNS void/);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO ''/);
  assert.match(body, /IF v_uid IS NULL[\s\S]*?AUTHORIZATION_REQUIRED/);
  assert.match(body, /IF NOT private\.current_user_is_better_auth\(\)[\s\S]*?BETTER_AUTH_ISSUER_REQUIRED/);
  assert.ok(
    body.indexOf("BETTER_AUTH_ISSUER_REQUIRED") < body.indexOf("FROM public.attempts"),
    "issuer must be checked before attempt lookup",
  );
  assert.match(body, /preview_owner_id IS DISTINCT FROM v_uid/);
  assert.match(body, /participant_id IS DISTINCT FROM v_uid/);
});

test("all six Production answer, skip, timeout and state RPC callers are documented against the shared guard", () => {
  const callers = [
    "public.answer_linear_exam_question(uuid,uuid,jsonb,boolean)",
    "public.choose_linear_exam_timeout(uuid,text)",
    "public.get_linear_exam_state(uuid)",
    "public.resolve_linear_exam_timeout(uuid)",
    "public.save_linear_exam_draft(uuid,uuid,jsonb)",
    "public.skip_linear_exam_question(uuid)",
  ];
  for (const signature of callers) {
    assert.ok(sql.includes("--   " + signature), "missing verified shared-helper caller " + signature);
  }
});

test("canonical participant creation rejects legacy identities and preserves ownership conditions", () => {
  const body = getFunction("private.ensure_canonical_participant_for_user");
  assert.match(body, /p_registration_id uuid DEFAULT NULL::uuid/);
  assert.match(body, /RETURNS uuid/);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO ''/);
  assert.match(body, /IF NOT private\.current_user_is_better_auth\(\)[\s\S]*?BETTER_AUTH_ISSUER_REQUIRED/);
  assert.match(body, /WHERE id = p_registration_id[\s\S]*?AND user_id = v_uid[\s\S]*?AND competition_id = p_competition_id/);
  assert.match(body, /WHERE competition_id = p_competition_id[\s\S]*?AND user_id = v_uid/);
  assert.match(body, /INSERT INTO public\.participants/);
  assert.match(body, /UPDATE public\.participants/);
});

test("these helper replacements do not delete or bulk-migrate legacy identities or application rows", () => {
  const exam = getFunction("private.assert_individual_linear_exam_access");
  const participant = getFunction("private.ensure_canonical_participant_for_user");
  const combined = exam + participant;
  assert.doesNotMatch(combined, /DELETE FROM auth\.users|TRUNCATE auth\.users|DELETE FROM private\.app_users/i);
  assert.doesNotMatch(combined, /UPDATE public\.participants\s+SET\s+user_id/i);
});
