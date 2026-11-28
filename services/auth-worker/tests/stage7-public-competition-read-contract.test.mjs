import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inventory = JSON.parse(readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-7-SECURITY-DEFINER-TRIAGE-2026-11-21.json", import.meta.url),
  "utf8",
));
const draft = readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql", import.meta.url),
  "utf8",
);
const regression = readFileSync(
  new URL("../../../scripts/auth-migration/stage3-issuer-guard-regression.sql", import.meta.url),
  "utf8",
);

const expected = new Map([
  ["get_public_competition_detail_summary(uuid)", {
    name: "get_public_competition_detail_summary",
    hash: "911222960fda1b15c410c5407482f548",
    searchPath: ["search_path=\"\""],
    returns: "TABLE(participant_count bigint, organizer_name text, organizer_logo_url text, question_bank_name text, question_provider_name text, question_count bigint)",
    publicAcl: false,
  }],
  ["get_public_competition_participants(text,integer,integer)", {
    name: "get_public_competition_participants",
    hash: "695758d3c7df1347a79fe5189439f35e",
    searchPath: ["search_path=\"\""],
    returns: "jsonb",
    publicAcl: false,
  }],
  ["get_public_competition_question_count(uuid)", {
    name: "get_public_competition_question_count",
    hash: "c1fd7dd6f06f405252d6e93b77498638",
    searchPath: ["search_path=\"\""],
    returns: "integer",
    publicAcl: true,
  }],
  ["get_public_competition_results(text,integer,integer)", {
    name: "get_public_competition_results",
    hash: "223b202465fb18d721d7a5fe1b011237",
    searchPath: ["search_path=\"\""],
    returns: "jsonb",
    publicAcl: false,
  }],
  ["get_public_competitions(integer)", {
    name: "get_public_competitions",
    hash: "72fda47f09a2bfa2a868e2458a1a1631",
    searchPath: ["search_path=public, private"],
    returns: "TABLE(id uuid, organizer_id uuid, slug text, title text, short_description text, description text, category text, status competition_status, registration_starts_at timestamp with time zone, registration_ends_at timestamp with time zone, starts_at timestamp with time zone, ends_at timestamp with time zone, announcement_at timestamp with time zone, poster_url text, juknis_url text, visibility text, participant_count bigint, organizer_name text, organizer_photo_url text)",
    publicAcl: false,
  }],
]);

function getDraftFunction(name) {
  const marker = "CREATE OR REPLACE FUNCTION public." + name + "(";
  const start = draft.lastIndexOf(marker);
  assert.notEqual(start, -1, "missing Stage 3 draft replacement for " + name);
  const end = draft.indexOf("$function$;", start);
  assert.notEqual(end, -1, "missing function terminator for " + name);
  return draft.slice(start, end + "$function$;".length);
}

test("five public competition RPCs match exact immutable Production fingerprints and metadata", () => {
  for (const [signature, expectedEntry] of expected) {
    const entry = inventory.functions.find((item) => item.signature === signature);
    assert.ok(entry, "missing exact Production triage signature " + signature);
    assert.equal(entry.sourceMd5, expectedEntry.hash, "Production function fingerprint changed: " + signature);
    assert.equal(entry.owner, "postgres");
    assert.equal(entry.language, signature.startsWith("get_public_competition_participants") ||
      signature.startsWith("get_public_competition_results") ? "plpgsql" : "sql");
    assert.deepEqual(entry.searchPathConfig, expectedEntry.searchPath);
    assert.equal(entry.returns, expectedEntry.returns);
    assert.equal(entry.suggestedClassification, "public_read");
    assert.equal(entry.execute.anon, true);
    assert.equal(entry.execute.authenticated, true);
    assert.equal(entry.execute.serviceRole, true);
    assert.equal(entry.acl.some((grant) => grant.startsWith("=X/")), expectedEntry.publicAcl);
    assert.ok(entry.acl.includes("anon=X/postgres"));
  }
});

test("detail, participants, and results RPCs explicitly require public competitions", () => {
  const detail = inventory.functions.find((item) => item.signature === "get_public_competition_detail_summary(uuid)");
  const participants = inventory.functions.find((item) => item.signature === "get_public_competition_participants(text,integer,integer)");
  const results = inventory.functions.find((item) => item.signature === "get_public_competition_results(text,integer,integer)");
  assert.match(detail.sourceExcerpt, /c\.visibility = 'PUBLIC'/);
  assert.match(participants.sourceExcerpt, /c\.visibility = 'PUBLIC'/);
  assert.match(results.sourceExcerpt, /visibility = 'PUBLIC'/);
  assert.match(results.sourceExcerpt, /RESULT_PUBLISHED/);
  assert.match(results.sourceExcerpt, /ARCHIVED/);
});

test("question-count replacement refuses to count questions on a PRIVATE competition", () => {
  const fn = getDraftFunction("get_public_competition_question_count");
  assert.match(fn, /RETURNS integer/);
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path TO ''/);
  assert.match(fn, /FROM public\.questions AS q/);
  assert.match(fn, /JOIN public\.competitions AS c ON c\.id = q\.competition_id/);
  assert.match(fn, /c\.visibility = 'PUBLIC'/);
  assert.match(fn, /c\.status IN \('LIVE', 'RESULT_PUBLISHED', 'ARCHIVED'\)/);
  assert.match(fn, /q\.status = 'PUBLISHED'/);
});

test("public competition list uses schema-qualified references and an empty search_path", () => {
  const fn = getDraftFunction("get_public_competitions");
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path TO ''/);
  assert.match(fn, /FROM public\.competitions AS c/);
  assert.match(fn, /LEFT JOIN public\.organizers AS o/);
  assert.match(fn, /LEFT JOIN public\.profiles AS op/);
  assert.match(fn, /FROM public\.registrations AS r/);
  assert.match(fn, /WHERE c\.visibility = 'PUBLIC'/);
  assert.match(fn, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 6\), 1\), 20\)/);
});

test("Stage 3 preflight pins all five exact Production hashes and canonical ACL grants before replacements", () => {
  const marker = "DO $stage7_public_competition_rpc_fingerprint_preflight$";
  const start = draft.indexOf(marker);
  const end = draft.indexOf("$stage7_public_competition_rpc_fingerprint_preflight$;", start);
  assert.ok(start >= 0 && end > start);
  const preflight = draft.slice(start, end);
  const questionCountStart = draft.indexOf("CREATE OR REPLACE FUNCTION public.get_public_competition_question_count(");
  const listStart = draft.indexOf("CREATE OR REPLACE FUNCTION public.get_public_competitions(");
  assert.ok(questionCountStart > end && listStart > end, "preflight must precede both replacements");
  for (const expectedEntry of expected.values()) {
    assert.ok(preflight.includes(expectedEntry.hash), "missing exact Production hash " + expectedEntry.hash);
  }
  assert.match(preflight, /pg_catalog\.aclexplode/);
  assert.match(preflight, /a\.is_grantable/);
  assert.match(preflight, /pg_catalog\.pg_get_function_result/);
  assert.match(preflight, /p\.prosecdef/);
  assert.match(preflight, /v_acl IS DISTINCT FROM v_expected\.acl/);
  assert.match(preflight, /has_function_privilege\('anon'/);
  assert.match(preflight, /has_function_privilege\('authenticated'/);
  assert.match(preflight, /has_function_privilege\('service_role'/);
});

test("rollback-only anon regression checks public and private competition metadata, rosters, and question counts", () => {
  const anonStart = regression.indexOf("DO $profile_anon$");
  const anonEnd = regression.indexOf("$profile_anon$;", anonStart);
  assert.ok(anonStart >= 0 && anonEnd > anonStart);
  const anonBlock = regression.slice(anonStart, anonEnd);
  for (const marker of [
    "STAGE3_ANON_PUBLIC_RESULTS_READ_FAILED",
    "STAGE3_ANON_PRIVATE_COMPETITION_RESULTS_ALLOWED",
    "STAGE7_ANON_PUBLIC_COMPETITIONS_READ_FAILED",
    "STAGE7_ANON_PRIVATE_COMPETITIONS_LEAK",
    "STAGE7_ANON_PUBLIC_COMPETITION_DETAIL_FAILED",
    "STAGE7_ANON_PRIVATE_COMPETITION_DETAIL_LEAK",
    "STAGE7_ANON_PUBLIC_COMPETITION_PARTICIPANTS_FAILED",
    "STAGE7_ANON_PRIVATE_COMPETITION_PARTICIPANTS_ALLOWED",
    "STAGE7_ANON_PUBLIC_COMPETITION_QUESTION_COUNT_FAILED",
    "STAGE7_ANON_PRIVATE_COMPETITION_QUESTION_COUNT_LEAK",
  ]) assert.ok(anonBlock.includes(marker), "missing public/private competition regression: " + marker);
  assert.match(regression, /Stage 7 public competition published question-count probe/);
  assert.match(regression, /Stage 7 private competition published question-count probe/);
  assert.match(regression, /'33333333-3333-4333-8333-333333333333'/);
  assert.match(regression, /'33333333-3333-4333-8333-333333333335'/);
  assert.match(regression.slice(anonEnd), /RESET ROLE;/);
  assert.match(regression, /ROLLBACK;/i);
});
