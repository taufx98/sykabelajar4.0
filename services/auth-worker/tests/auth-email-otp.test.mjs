import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const auth = read("../src/auth.ts");
const email = read("../src/email.ts");
const worker = read("../src/worker.ts");
const packageJson = read("../package.json");
const client = read("../../../src/services/betterAuthApi.client.ts");
const authService = read("../../../src/services/auth.service.ts");
const register = read("../../../src/pages/RegisterPage.tsx");
const login = read("../../../src/pages/LoginPage.tsx");
const verifyPage = read("../../../src/pages/AuthEmailVerifiedPage.tsx");

test("pinned Better Auth Email OTP plugin replaces only default verification-link delivery", () => {
  assert.match(packageJson, /"better-auth": "1\.7\.16"/);
  assert.match(auth, /import \{ emailOTP, jwt \} from "better-auth\/plugins"/);
  assert.match(auth, /emailOTP\(\{/);
  assert.match(auth, /overrideDefaultEmailVerification: true/);
  assert.match(auth, /otpLength: 6/);
  assert.match(auth, /expiresIn: 300/);
  assert.match(auth, /allowedAttempts: 3/);
  assert.match(auth, /storeOTP: "encrypted"/);
  assert.match(auth, /type !== "email-verification"/);
  assert.match(auth, /action: "verify-email-otp"/);
  assert.match(auth, /autoSignInAfterVerification: true/);
  assert.match(auth, /afterEmailVerification: async \(user\)/);
});

test("OTP email uses existing transactional email dispatch and contains a code rather than a link", () => {
  assert.match(email, /"verify-email-otp"/);
  assert.match(auth, /Kode verifikasi email SYKABELAJAR Anda:/);
  assert.match(auth, /berlaku selama 5 menit dan maksimal 3 percobaan/);
});

test("Worker permits verification OTP but blocks passwordless sign-in and OTP password reset", () => {
  assert.match(worker, /email-otp\/send-verification-otp/);
  assert.match(worker, /payload\?\.type !== "email-verification"/);
  assert.match(worker, /blockedEmailOtpPaths/);
  assert.match(worker, /EMAIL_OTP_ROUTE_NOT_AVAILABLE/);
  assert.doesNotMatch(worker, /"\/api\/auth\/email-otp\/verify-email"/);
});

test("frontend sends, resends and verifies six-digit OTP through Better Auth", () => {
  assert.match(client, /sendVerificationOtp\(email: string\)/);
  assert.match(client, /verifyEmailOtp\(email: string, otp: string\)/);
  assert.match(client, /\/email-otp\/send-verification-otp/);
  assert.match(client, /\/email-otp\/verify-email/);
  assert.match(client, /type: 'email-verification'/);
  assert.match(authService, /sendVerificationOtp\(normalizedEmail\)/);
  assert.match(register, /navigate\('\/auth\/verified', \{ state: \{ email:/);
  assert.match(login, /navigate\('\/auth\/verified', \{ state: \{ email:/);
  assert.match(verifyPage, /autoComplete="one-time-code"/);
  assert.match(verifyPage, /Verifikasi kode/);
  assert.match(verifyPage, /Kirim ulang kode/);
  assert.match(verifyPage, /window\.location\.replace\('\/home'\)/);
});
