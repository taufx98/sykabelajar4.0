import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../../../src/components/admin/TransactionalEmailSettingsPanel.tsx", import.meta.url), "utf8");
const workerConfig = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const previewHost = "security-auth-poc-stage-1.sykabelajar4.pages.dev";

test("email Admin browser endpoint and staging Worker CORS origin stay synchronized", () => {
  assert.ok(panel.includes("const STAGING_PREVIEW_HOST = '" + previewHost + "';"));
  assert.ok(workerConfig.includes('EMAIL_ADMIN_PREVIEW_ORIGIN = "https://' + previewHost + '"'));
});
