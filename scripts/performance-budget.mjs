export const PERFORMANCE_BUDGET = Object.freeze({
  entryJsGzipBytes: 200_000,
  cssGzipBytes: 50_000,
  initialAssetsGzipBytes: 220_000,
});

export function evaluatePerformanceBudget(
  { entryJsGzipBytes, cssGzipBytes },
  budget = PERFORMANCE_BUDGET,
) {
  const measurements = { entryJsGzipBytes, cssGzipBytes };
  for (const [name, value] of Object.entries(measurements)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(name + " must be a non-negative safe integer.");
    }
  }

  const checks = [
    {
      name: "Entry JavaScript (gzip)",
      actualBytes: entryJsGzipBytes,
      budgetBytes: budget.entryJsGzipBytes,
    },
    {
      name: "CSS (gzip)",
      actualBytes: cssGzipBytes,
      budgetBytes: budget.cssGzipBytes,
    },
    {
      name: "Initial JS + CSS (gzip)",
      actualBytes: entryJsGzipBytes + cssGzipBytes,
      budgetBytes: budget.initialAssetsGzipBytes,
    },
  ].map((check) => ({ ...check, passed: check.actualBytes <= check.budgetBytes }));

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}
