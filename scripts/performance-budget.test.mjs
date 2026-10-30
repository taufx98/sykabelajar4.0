import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePerformanceBudget, PERFORMANCE_BUDGET } from "./performance-budget.mjs";

test("accepts the measured October 2026 initial-load baseline", () => {
  const result = evaluatePerformanceBudget({
    entryJsGzipBytes: 178_640,
    cssGzipBytes: 18_180,
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.checks.map((check) => check.passed), [true, true, true]);
});

test("accepts assets exactly on each configured limit", () => {
  const result = evaluatePerformanceBudget({
    entryJsGzipBytes: PERFORMANCE_BUDGET.entryJsGzipBytes,
    cssGzipBytes: PERFORMANCE_BUDGET.cssGzipBytes,
  }, {
    ...PERFORMANCE_BUDGET,
    initialAssetsGzipBytes: PERFORMANCE_BUDGET.entryJsGzipBytes + PERFORMANCE_BUDGET.cssGzipBytes,
  });

  assert.equal(result.passed, true);
});

test("rejects an entry JavaScript bundle above its limit", () => {
  const result = evaluatePerformanceBudget({
    entryJsGzipBytes: PERFORMANCE_BUDGET.entryJsGzipBytes + 1,
    cssGzipBytes: 1,
  });

  assert.equal(result.passed, false);
  assert.equal(result.checks[0].passed, false);
});

test("rejects CSS above its limit", () => {
  const result = evaluatePerformanceBudget({
    entryJsGzipBytes: 1,
    cssGzipBytes: PERFORMANCE_BUDGET.cssGzipBytes + 1,
  });

  assert.equal(result.passed, false);
  assert.equal(result.checks[1].passed, false);
});

test("rejects a combined initial payload above its limit", () => {
  const result = evaluatePerformanceBudget({
    entryJsGzipBytes: 180_000,
    cssGzipBytes: 45_001,
  });

  assert.equal(result.passed, false);
  assert.equal(result.checks[0].passed, true);
  assert.equal(result.checks[1].passed, true);
  assert.equal(result.checks[2].passed, false);
});

test("rejects missing, negative, or unsafe byte measurements", () => {
  for (const value of [undefined, -1, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    assert.throws(
      () => evaluatePerformanceBudget({ entryJsGzipBytes: value, cssGzipBytes: 0 }),
      TypeError,
    );
  }
});
