import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const sql = read("scripts/auth-migration/stage7-public-shop-banner-rpc-regression.sql");
const workflow = read(".github/workflows/auth-schema-baseline.yml");

for (const marker of [
  "STAGE7_BANNER_FIXTURE_UUID_COLLISION",
  "public.list_active_shop_promo_banners()",
  "public.record_shop_promo_banner_event(uuid,text,text)",
  "STAGE7_BANNER_DIRECT_BROWSER_TABLE_ACCESS_REMAINS",
  "STAGE7_BANNER_ACTIVE_ONLY_LIST_FAILED",
  "STAGE7_BANNER_VALID_VIEW_NOT_RECORDED",
  "STAGE7_BANNER_DUPLICATE_VIEW_NOT_IDEMPOTENT",
  "STAGE7_BANNER_VALID_CLICK_NOT_RECORDED",
  "STAGE7_BANNER_INACTIVE_EVENT_ACCEPTED",
  "STAGE7_BANNER_MISSING_EVENT_TARGET_ACCEPTED",
  "STAGE7_BANNER_INVALID_EVENT_TYPE_ACCEPTED",
  "STAGE7_BANNER_INVALID_VISITOR_KEY_ACCEPTED",
  "STAGE7_BANNER_EVENT_LEDGER_OR_COUNTER_DRIFT",
  "RESET ROLE;",
  "ROLLBACK;",
]) assert.ok(sql.includes(marker), "missing Stage 7 banner RPC runtime assertion: " + marker);

assert.match(sql, /SET LOCAL ROLE anon[\s\S]*?list_active_shop_promo_banners[\s\S]*?record_shop_promo_banner_event/);
assert.match(sql, /has_function_privilege\('anon'[\s\S]*?EXECUTE/);
assert.match(sql, /has_table_privilege\('anon'/);
assert.doesNotMatch(sql, /^\s*(?:CREATE POLICY|GRANT|REVOKE|ALTER TABLE[^\n]*DISABLE TRIGGER)\b/im,
  "banner acceptance may not alter policies, grants, revokes or disable triggers");
assert.match(workflow, /Test Stage 7 public shop-promo banner RPC contract[\s\S]*?stage7-public-shop-banner-rpc\.contract\.test\.mjs/);
assert.match(workflow, /Run Stage 7 public shop-promo banner RPC acceptance[\s\S]*?stage7-public-shop-banner-rpc-regression\.sql/);

console.log("Stage 7 public shop-promo banner RPC contract passed: active-only read, validated/deduplicated events, counters and no direct browser table grants.");
