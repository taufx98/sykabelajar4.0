import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyD1FreeQuotaError,
  createD1QuotaResponse,
} from "../src/d1-quota.mjs";

test("classifies the documented D1 daily read quota error", () => {
  const error = new Error(
    "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Wait until tomorrow.",
  );
  assert.equal(classifyD1FreeQuotaError(error), "ROWS_READ");
});

test("classifies the documented D1 daily write quota error nested in a cause", () => {
  const error = new Error("Better Auth database operation failed", {
    cause: new Error(
      "Your account has exceeded D1's free tier daily row write limit. Wait until tomorrow.",
    ),
  });
  assert.equal(classifyD1FreeQuotaError(error), "ROWS_WRITTEN");
});

test("does not classify ordinary authentication or SQLite errors as a quota outage", () => {
  assert.equal(classifyD1FreeQuotaError(new Error("UNIQUE constraint failed")), null);
  assert.equal(classifyD1FreeQuotaError(new Error("Invalid password")), null);
  assert.equal(classifyD1FreeQuotaError(null), null);
});

test("quota response is a safe 503 and retries at next midnight UTC", async () => {
  const now = new Date("2026-11-04T16:30:00.000Z");
  const response = createD1QuotaResponse(
    new Error("Your account has exceeded D1's free tier daily row read limit."),
    now,
  );

  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Auth-Availability"), "degraded");
  assert.equal(response.headers.get("Retry-After"), String(7.5 * 60 * 60));
  const body = await response.json();
  assert.equal(body.code, "D1_FREE_TIER_ROWS_READ_LIMIT_REACHED");
  assert.equal(body.retry_at_utc, "2026-11-05T00:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(body), /D1_ERROR:/);
});

test("quota response distinguishes the write limit and avoids a false retry window", async () => {
  const now = new Date("2026-11-04T23:59:59.500Z");
  const response = createD1QuotaResponse(
    new Error("Your account has exceeded D1's free tier daily row write limit."),
    now,
  );

  assert.ok(response);
  assert.equal(response.headers.get("Retry-After"), "1");
  const body = await response.json();
  assert.equal(body.code, "D1_FREE_TIER_ROWS_WRITTEN_LIMIT_REACHED");
});

test("non-quota errors produce no special response", () => {
  assert.equal(createD1QuotaResponse(new Error("database unavailable")), null);
});
