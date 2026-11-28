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
  ["get_competition_participant_detail(text,uuid)", {
    hash: "68183b7176c3f24ec95c018d13b973ef",
    searchPath: ["search_path=\"\""],
    returns: "jsonb",
    language: "plpgsql",
  }],
  ["get_home_snapshot(integer)", {
    hash: "6c57e4102a8a51b39602625f6aeb2eaf",
    searchPath: ["search_path=public, private"],
    returns: "jsonb",
    language: "sql",
  }],
  ["get_public_feed(integer,timestamp with time zone)", {
    hash: "1944c33d7a1d0404151de702e13e894f",
    searchPath: ["search_path=public, private"],
    returns: "TABLE(id uuid, author_user_id uuid, author_name text, author_username text, avatar_url text, title text, body text, cover_url text, created_at timestamp with time zone, competition_id uuid, competition_slug text, likes bigint, liked boolean, comments bigint, organizer_name text, organizer_photo_url text)",
    language: "sql",
  }],
  ["is_public_profile_admin(uuid)", {
    hash: "e94eb7f539ab889dc503ce9d04b36886",
    searchPath: ["search_path=\"\""],
    returns: "boolean",
    language: "sql",
  }],
  ["get_public_collective_certificate(text)", {
    hash: "7a47a902b83e1ea7e2915f69791f55b0",
    searchPath: ["search_path=public"],
    returns: "jsonb",
    language: "sql",
  }],
]);

function getDraftFunction(name) {
  const marker = "CREATE OR REPLACE FUNCTION public." + name + "(";
  const start = draft.lastIndexOf(marker);
  assert.notEqual(start, -1, "missing Stage 3 replacement for " + name);
  const end = draft.indexOf("$function$;", start);
  assert.notEqual(end, -1, "missing function terminator for " + name);
  return draft.slice(start, end + "$function$;".length);
}

test("five public profile/feed RPCs match immutable Production fingerprints and ACLs", () => {
  for (const [signature, expectedEntry] of expected) {
    const entry = inventory.functions.find((item) => item.signature === signature);
    assert.ok(entry, "missing exact Production triage signature " + signature);
    assert.equal(entry.sourceMd5, expectedEntry.hash);
    assert.equal(entry.owner, "postgres");
    assert.deepEqual(entry.searchPathConfig, expectedEntry.searchPath);
    assert.equal(entry.returns, expectedEntry.returns);
    assert.equal(entry.language, expectedEntry.language);
    assert.equal(entry.suggestedClassification, "public_read");
    assert.equal(entry.execute.anon, true);
    assert.equal(entry.execute.authenticated, true);
    assert.equal(entry.execute.serviceRole, true);
    assert.ok(entry.acl.includes("anon=X/postgres"));
    assert.equal(entry.acl.some((grant) => grant.startsWith("=X/")), false);
  }
});

test("private participant detail fallback and badge visibility are Better Auth bound", () => {
  const fn = getDraftFunction("get_competition_participant_detail");
  assert.match(fn, /private\.current_user_is_better_auth\(\)/);
  assert.match(fn, /private\.current_user_is_admin\(\)/);
  assert.match(fn, /private\.current_user_can_edit_competition\(/);
  assert.match(fn, /coalesce\(p\.is_public, false\)/);
  assert.match(fn, /coalesce\(settings\.show_badge_collection, true\)/);
  assert.match(fn, /SET search_path TO ''/);
  assert.match(fn, /aw\.visibility = 'PUBLIC'/);
  assert.match(fn, /cert\.status::text = 'PUBLISHED'/);
});

test("public Admin helper verifies the Better Auth identity foundation before returning a role bit", () => {
  const fn = getDraftFunction("is_public_profile_admin");
  assert.match(fn, /JOIN private\.app_users AS app_user/i);
  assert.match(fn, /app_user\.identity_origin = 'better_auth'/);
  assert.match(fn, /ur\.role::text = 'admin'/);
  assert.match(fn, /ur\.is_active IS TRUE/i);
  assert.match(fn, /coalesce\(p\.is_public, true\) IS TRUE OR p\.id = \(SELECT auth\.uid\(\)\)/i);
  assert.match(fn, /SET search_path TO ''/);
});

test("home snapshot uses only schema-qualified public endpoints and an empty search_path", () => {
  const fn = getDraftFunction("get_home_snapshot");
  assert.match(fn, /SET search_path TO ''/);
  for (const call of [
    "public.get_public_competitions(5)",
    "public.get_public_leaderboard(5)",
    "public.get_public_coin_leaderboard(5)",
    "public.get_platform_stats()",
    "public.get_public_feed(",
  ]) assert.ok(fn.includes(call), "home snapshot must use " + call);
  assert.match(fn, /LEAST\(GREATEST\(COALESCE\(p_feed_limit, 15\), 1\), 16\)/);
});

test("public feed preserves the published-only projection and removes caller search_path", () => {
  const fn = getDraftFunction("get_public_feed");
  assert.match(fn, /SET search_path TO ''/);
  assert.match(fn, /FROM public\.posts AS p/);
  assert.match(fn, /LEFT JOIN public\.profiles AS pr/);
  assert.match(fn, /LEFT JOIN public\.competitions AS c/);
  assert.match(fn, /FROM public\.post_likes AS pl/);
  assert.match(fn, /FROM public\.comments AS cm/);
  assert.match(fn, /WHERE p\.status = 'PUBLISHED'/);
  assert.match(fn, /p_before IS NULL OR p\.created_at < p_before/);
  assert.match(fn, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 16\), 1\), 31\)/);
});

test("public collective certificate exposes only explicitly published or revoked certificates", () => {
  const fn = getDraftFunction("get_public_collective_certificate");
  assert.match(fn, /SET search_path TO ''/);
  assert.match(fn, /FROM public\.collective_certificates AS cc/);
  assert.match(fn, /JOIN public\.collective_participants AS cp/);
  assert.match(fn, /JOIN public\.competitions AS c/);
  assert.match(fn, /cc\.status IN \('PUBLISHED', 'REVOKED'\)/);
  assert.match(fn, /upper\(cc\.verification_code\) = upper\(trim\(p_verification_code\)\)/);
});

test("Stage 3 preflight pins all five exact Production hashes and ACL metadata before any replacement", () => {
  const marker = "DO $stage7_public_profile_feed_rpc_preflight$";
  const start = draft.indexOf(marker);
  const end = draft.indexOf("$stage7_public_profile_feed_rpc_preflight$;", start);
  assert.ok(start >= 0 && end > start);
  const preflight = draft.slice(start, end);
  for (const expectedEntry of expected.values()) {
    assert.ok(preflight.includes(expectedEntry.hash), "missing Production hash " + expectedEntry.hash);
  }
  for (const name of [
    "get_competition_participant_detail",
    "is_public_profile_admin",
    "get_home_snapshot",
    "get_public_feed",
    "get_public_collective_certificate",
  ]) {
    assert.ok(
      start < draft.indexOf("CREATE OR REPLACE FUNCTION public." + name + "("),
      "preflight must precede replacement for " + name,
    );
  }
  assert.match(preflight, /pg_catalog\.aclexplode/);
  assert.match(preflight, /a\.is_grantable/);
  assert.match(preflight, /p\.prosecdef/);
  assert.match(preflight, /v_acl IS DISTINCT FROM v_expected\.acl/);
  assert.match(preflight, /pg_catalog\.pg_get_function_result/);
  assert.match(preflight, /has_function_privilege\('anon'/);
  assert.match(preflight, /has_function_privilege\('authenticated'/);
  assert.match(preflight, /has_function_privilege\('service_role'/);
});

test("rollback-only anon regression checks feed/home, Admin privacy, certificate status and private result detail", () => {
  const feedFixture = regression.indexOf("-- Tranche 20 public-feed and certificate visibility fixtures.");
  const anonRole = regression.indexOf("SET LOCAL ROLE anon;");
  const anonStart = regression.indexOf("DO $profile_anon$");
  assert.ok(feedFixture >= 0 && feedFixture < anonRole, "public feed/certificate fixtures must be seeded before switching to anon");
  assert.ok(anonRole < anonStart, "anonymous RLS assertions must run after switching to anon");
  const anonEnd = regression.indexOf("$profile_anon$;", anonStart);
  assert.ok(anonStart >= 0 && anonEnd > anonStart);
  const anonBlock = regression.slice(anonStart, anonEnd);
  for (const marker of [
    "STAGE7_ANON_PUBLIC_FEED_PUBLISHED_POST_FAILED",
    "STAGE7_ANON_PUBLIC_FEED_DRAFT_POST_LEAK",
    "STAGE7_ANON_HOME_SNAPSHOT_SHAPE_FAILED",
    "STAGE7_ANON_HOME_SNAPSHOT_PUBLIC_FEED_MISSING",
    "STAGE7_ANON_HOME_SNAPSHOT_DRAFT_FEED_LEAK",
    "STAGE7_ANON_PUBLIC_ADMIN_PROFILE_FLAG_FAILED",
    "STAGE7_ANON_PRIVATE_ADMIN_PROFILE_FLAG_LEAK",
    "STAGE7_ANON_PUBLIC_NON_ADMIN_PROFILE_FLAG_FAILED",
    "STAGE7_ANON_ELIGIBLE_COLLECTIVE_CERTIFICATE_LEAK",
    "STAGE7_ANON_PRIVATE_PARTICIPANT_DETAIL_ALLOWED",
  ]) assert.ok(anonBlock.includes(marker), "missing anonymous public-read regression " + marker);
  assert.match(regression, /Stage 7 public feed boundary probe/);
  assert.match(regression, /Stage 7 draft feed boundary probe/);
  assert.match(regression, /STAGE7-TRANCHE20-ELIGIBLE-CERT/);
  assert.match(regression, /UPDATE public\.collective_certificates/);
  assert.match(regression.slice(anonEnd), /RESET ROLE;/);
  assert.match(regression, /ROLLBACK;/i);
});
