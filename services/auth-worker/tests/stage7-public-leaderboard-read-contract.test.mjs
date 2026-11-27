import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inventory = JSON.parse(readFileSync(
  new URL("../../../docs/security/AUTH-STAGE-7-SECURITY-DEFINER-TRIAGE-2026-11-21.json", import.meta.url),
  "utf8",
));
const regression = readFileSync(
  new URL("../../../scripts/auth-migration/stage3-issuer-guard-regression.sql", import.meta.url),
  "utf8",
);
const leaderboardMigration = readFileSync(
  new URL("../../../supabase/migrations/20261029123000_leaderboard_ranking_enrichment.sql", import.meta.url),
  "utf8",
);

const expected = new Map([
  ["get_platform_stats()", {
    hash: "89940ccab266fee4780fbe2999d8e000",
    searchPath: ["search_path=public"],
    returnType: "TABLE(total_users bigint, total_students bigint, total_schools bigint, total_competitions bigint, total_public_competitions bigint, total_certificates bigint)",
    publicAcl: true,
  }],
  ["get_public_coin_leaderboard(integer)", {
    hash: "c340deca8807f29674602e920f452837",
    searchPath: ["search_path=public, private"],
    returnType: "TABLE(user_id uuid, username text, display_name text, institution text, avatar_url text, grade text, edu_coin bigint, rank integer)",
    publicAcl: true,
  }],
  ["get_public_leaderboard(integer)", {
    hash: "56a97da61639d334dcdc5298f14c2faa",
    searchPath: ["search_path=public, private"],
    returnType: "TABLE(user_id uuid, username text, display_name text, institution text, avatar_url text, grade text, xp bigint, rank integer, rank_change text, point_change bigint)",
    publicAcl: true,
  }],
  ["get_public_leaderboard_enriched(text,integer)", {
    hash: "442f3995f43dec475d5ed8c79fdbfb8f",
    searchPath: ["search_path=public, private, pg_catalog"],
    returnType: "TABLE(user_id uuid, username text, display_name text, institution text, avatar_url text, grade text, xp bigint, rank integer, rank_change text, point_change bigint, average_score numeric, competitions_count bigint, school_id uuid)",
    publicAcl: false,
  }],
  ["get_public_school_leaderboard(text,integer)", {
    hash: "efab75373f8f4db86e2f1e917ee8fe55",
    searchPath: ["search_path=public, private, pg_catalog"],
    returnType: "TABLE(school_key text, school_id uuid, school_name text, student_count integer, levels text, average_score numeric, competitions_count bigint, xp bigint, rank integer, top_students jsonb)",
    publicAcl: false,
  }],
]);

function getMigrationFunction(name) {
  const marker = "CREATE OR REPLACE FUNCTION public." + name + "(";
  const start = leaderboardMigration.indexOf(marker);
  assert.notEqual(start, -1, "missing migration function " + name);
  const end = leaderboardMigration.indexOf("$function$;", start);
  assert.notEqual(end, -1, "missing terminator for " + name);
  return leaderboardMigration.slice(start, end + "$function$;".length);
}

test("five public statistics/leaderboard signatures still match immutable Production triage", () => {
  for (const [signature, expectedEntry] of expected) {
    const entry = inventory.functions.find((item) => item.signature === signature);
    assert.ok(entry, "missing exact Production triage signature " + signature);
    assert.equal(entry.sourceMd5, expectedEntry.hash, "Production source fingerprint changed: " + signature);
    assert.equal(entry.owner, "postgres");
    assert.equal(entry.language, "sql");
    assert.equal(entry.suggestedClassification, "public_read");
    assert.equal(entry.reviewStatus, "not_reviewed", "do not mutate the immutable triage snapshot");
    assert.deepEqual(entry.searchPathConfig, expectedEntry.searchPath);
    assert.equal(entry.returns, expectedEntry.returnType);
    assert.equal(entry.riskFlags.anonExecutable, true);
    assert.equal(entry.execute.anon, true);
    assert.equal(entry.execute.authenticated, true);
    assert.equal(entry.execute.serviceRole, true);
    assert.equal(entry.acl.some((grant) => grant.startsWith("=X/")), expectedEntry.publicAcl);
    assert.equal(entry.acl.includes("anon=X/postgres"), true);
  }
});

test("platform statistics exposes aggregate counts rather than profile rows", () => {
  const entry = inventory.functions.find((item) => item.signature === "get_platform_stats()");
  assert.match(entry.sourceExcerpt, /SELECT \(SELECT COUNT\(\*\) FROM public\.profiles WHERE status='ACTIVE'\)/i);
  assert.equal((entry.sourceExcerpt.match(/COUNT\(\*\)/gi) ?? []).length, 6);
  assert.match(entry.sourceExcerpt, /visibility='PUBLIC'/);
  assert.match(entry.sourceExcerpt, /status IN \('GENERATED','REVIEW','APPROVED','PUBLISHED'\)/);
  assert.doesNotMatch(entry.sourceExcerpt, /user_id|email|phone|avatar_url/i);
});

test("legacy XP and coin leaderboards are bounded and filter private/inactive/Admin identities", () => {
  for (const signature of ["get_public_coin_leaderboard(integer)", "get_public_leaderboard(integer)"]) {
    const entry = inventory.functions.find((item) => item.signature === signature);
    assert.match(entry.sourceExcerpt, /pr\.status='ACTIVE'::user_status/);
    assert.match(entry.sourceExcerpt, /coalesce\(pr\.is_public,true\)=true/);
    assert.match(entry.sourceExcerpt, /ur\.role='admin'::app_role/);
    assert.match(entry.sourceExcerpt, /ur\.is_active=true/);
    assert.match(entry.sourceExcerpt, /rn<=greatest\(1,least\(coalesce\(p_limit,100\),1000/);
  }
});

test("enriched public leaderboard derives rows from active, public, non-Admin profiles", () => {
  const fn = getMigrationFunction("get_public_leaderboard_enriched");
  assert.match(fn, /public_profiles AS \(/i);
  assert.match(fn, /ur\.user_id IS NULL/i);
  assert.match(fn, /pr\.status::text = 'ACTIVE'/i);
  assert.match(fn, /coalesce\(pr\.is_public, true\) = true/i);
  assert.match(fn, /greatest\(1, least\(coalesce\(p_limit, 100\), 1000\)\)/i);
  assert.match(fn, /period_key[\s\S]*weekly[\s\S]*monthly/i);
});

test("school leaderboard aggregates only the public-profile CTE and limits top students", () => {
  const fn = getMigrationFunction("get_public_school_leaderboard");
  assert.match(fn, /public_profiles AS \(/i);
  assert.match(fn, /ur\.user_id IS NULL/i);
  assert.match(fn, /pr\.status::text = 'ACTIVE'/i);
  assert.match(fn, /coalesce\(pr\.is_public, true\) = true/i);
  assert.match(fn, /school_members AS \(\s*SELECT \* FROM scored\s*\)/i);
  assert.match(fn, /LIMIT 5/i);
  assert.match(fn, /greatest\(1, least\(coalesce\(p_limit, 100\), 1000\)\)/i);
});

test("rollback-only anon regression positively reads public profiles and excludes all private/Admin fixtures", () => {
  const anonStart = regression.indexOf("SET LOCAL ROLE anon;");
  const anonBlockStart = regression.indexOf("DO $profile_anon$", anonStart);
  const anonBlockEnd = regression.indexOf("$profile_anon$;", anonBlockStart);
  assert.ok(anonStart >= 0 && anonBlockStart > anonStart && anonBlockEnd > anonBlockStart);
  const anonBlock = regression.slice(anonBlockStart, anonBlockEnd);
  for (const marker of [
    "STAGE7_ANON_PLATFORM_STATS_ROW_FAILED",
    "STAGE7_ANON_PUBLIC_XP_LEADERBOARD_FAILED",
    "STAGE7_ANON_PRIVATE_XP_LEADERBOARD_LEAK",
    "STAGE7_ANON_PUBLIC_ADMIN_XP_LEADERBOARD_LEAK",
    "STAGE7_ANON_PUBLIC_COIN_LEADERBOARD_FAILED",
    "STAGE7_ANON_PRIVATE_COIN_LEADERBOARD_LEAK",
    "STAGE7_ANON_PUBLIC_ADMIN_COIN_LEADERBOARD_LEAK",
    "STAGE7_ANON_PUBLIC_ENRICHED_LEADERBOARD_FAILED",
    "STAGE7_ANON_PRIVATE_ENRICHED_LEADERBOARD_LEAK",
    "STAGE7_ANON_PUBLIC_ADMIN_ENRICHED_LEADERBOARD_LEAK",
    "STAGE7_ANON_PUBLIC_SCHOOL_LEADERBOARD_FAILED",
  ]) assert.ok(anonBlock.includes(marker), "missing anonymous public-read regression: " + marker);
  assert.match(regression.slice(anonBlockEnd), /RESET ROLE;/);
  assert.match(regression, /ROLLBACK;/i);
});
