import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../../../src/services/betterAuthApi.client.ts", import.meta.url), "utf8");
const login = readFileSync(new URL("../../../src/pages/LoginPage.tsx", import.meta.url), "utf8");
const register = readFileSync(new URL("../../../src/pages/RegisterPage.tsx", import.meta.url), "utf8");

test("Better Auth staging signup checks delivery readiness before creating an account", () => {
  const method = client.slice(client.indexOf("async signUp(input)"), client.indexOf("async requestPasswordReset", client.indexOf("async signUp(input)")));
  assert.ok(method.indexOf("getEmailVerificationConfigured()") >= 0);
  assert.ok(method.indexOf("EMAIL_VERIFICATION_DELIVERY_NOT_CONFIGURED") < method.indexOf("'/sign-up/email'"));
  assert.ok(method.indexOf("getEmailVerificationConfigured()") < method.indexOf("'/sign-up/email'"));
});

test("verification resend is never attempted when the staging email sender is unavailable", () => {
  const method = client.slice(client.indexOf("async sendVerificationEmail"), client.indexOf("async requestPasswordReset"));
  assert.ok(method.indexOf("getEmailVerificationConfigured()") >= 0);
  assert.ok(method.indexOf("EMAIL_VERIFICATION_DELIVERY_NOT_CONFIGURED") < method.indexOf("'/send-verification-email'"));
});

test("login UI discloses inactive staging email delivery and disables resend", () => {
  assert.match(login, /emailVerificationConfigured === false/);
  assert.match(login, /emailVerificationConfigured !== true/);
  assert.match(login, /belum aktif di staging/);
});

test("registration UI blocks staging signup until email verification delivery is ready", () => {
  assert.match(register, /getEmailVerificationConfigured\(\)/);
  assert.match(register, /emailVerificationConfigured !== true/);
  assert.match(register, /Pendaftaran staging sedang ditahan/);
});
