import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const edgeRoot = new URL("../../supabase/functions/", import.meta.url);
const identityResolver = readFileSync(new URL("_shared/require-application-user.ts", edgeRoot), "utf8");
const paymentAdmin = readFileSync(new URL("payment-gateway-admin/index.ts", edgeRoot), "utf8");
const paymentCreate = readFileSync(new URL("payment-gateway-create/index.ts", edgeRoot), "utf8");
const paymentReconcile = readFileSync(new URL("payment-gateway-reconcile/index.ts", edgeRoot), "utf8");

const cloudinarySignature = readFileSync(new URL("../../supabase/functions/get-cloudinary-signature/index.ts", import.meta.url), "utf8");
const cloudinaryDelete = readFileSync(new URL("../../supabase/functions/cloudinary-delete-asset/index.ts", import.meta.url), "utf8");
const cloudinaryUpload = readFileSync(new URL("../../supabase/functions/cloudinary-profile-upload/index.ts", import.meta.url), "utf8");
const cloudinaryDeleteProfile = readFileSync(new URL("../../supabase/functions/cloudinary-delete-profile/index.ts", import.meta.url), "utf8");
const midtransDelegate = readFileSync(new URL("../../supabase/functions/midtrans-create-payment/index.ts", import.meta.url), "utf8");
const paymentWebhook = readFileSync(new URL("../../supabase/functions/payment-gateway-webhook/index.ts", import.meta.url), "utf8");
const functionConfig = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");

function stripSourceComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}


test("shared application identity defaults to legacy Supabase and Better Auth is explicit opt-in", () => {
  assert.match(identityResolver, /AUTH_IDENTITY_MODE/);
  assert.match(identityResolver, /\?\.trim\(\) \|\| "supabase"/);
  assert.match(identityResolver, /mode === "better-auth"/);
  assert.match(identityResolver, /requireBetterAuthUser\(request\)/);
  assert.match(identityResolver, /supabase\.auth\.getUser\(\)/);
  assert.match(identityResolver, /AbortSignal\.timeout\(5000\)/);
  assert.match(identityResolver, /AUTH_IDENTITY_MODE_INVALID/);
  assert.doesNotMatch(identityResolver, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
});

test("payment admin checks active admin using the caller-scoped identity before service-role access", () => {
  assert.match(paymentAdmin, /requireApplicationUser\(req\)/);
  assert.match(paymentAdmin, /const \{ userId, supabase: authClient \} = identity/);
  assert.match(paymentAdmin, /authClient\.rpc\("is_active_admin", \{ p_uid: userId \}\)/);
  assert.match(paymentAdmin, /ADMIN_REQUIRED/);
  const identity = paymentAdmin.indexOf("requireApplicationUser(req)");
  const roleCheck = paymentAdmin.indexOf('authClient.rpc("is_active_admin"');
  const serviceRole = paymentAdmin.indexOf('createClient(supabaseUrl, serviceRoleKey)');
  assert.ok(identity >= 0 && roleCheck > identity && serviceRole > roleCheck);
  assert.match(paymentAdmin, /updated_by: userId/);
  assert.doesNotMatch(paymentAdmin, /auth\.getUser\(/);
});

test("payment checkout keeps the verified canonical UUID as the sole order-owner check", () => {
  assert.match(paymentCreate, /requireApplicationUser\(req\)/);
  assert.match(paymentCreate, /const \{ userId, userEmail \} = identity/);
  assert.match(paymentCreate, /order\.user_id !== userId/);
  assert.match(paymentCreate, /\.eq\("id", orderId\)/);
  assert.match(paymentCreate, /userEmail/);
  assert.doesNotMatch(paymentCreate, /auth\.getUser\(|authData\.user/);
  const identity = paymentCreate.indexOf("requireApplicationUser(req)");
  const serviceRole = paymentCreate.indexOf('createClient(supabaseUrl, serviceRoleKey)');
  const ownerGuard = paymentCreate.indexOf("order.user_id !== userId");
  assert.ok(identity >= 0 && serviceRole > identity && ownerGuard > serviceRole);
});

test("payment reconciliation scopes all order lookups and checks to the verified UUID", () => {
  assert.match(paymentReconcile, /requireApplicationUser\(req\)/);
  assert.match(paymentReconcile, /const \{ userId \} = identity/);
  assert.match(paymentReconcile, /\.eq\("user_id", userId\)/);
  assert.match(paymentReconcile, /order\.user_id !== userId/);
  assert.match(paymentReconcile, /process_payment_gateway_success/);
  assert.doesNotMatch(paymentReconcile, /auth\.getUser\(|authData\.user/);
  const identity = paymentReconcile.indexOf("requireApplicationUser(req)");
  const serviceRole = paymentReconcile.indexOf('createClient(supabaseUrl, serviceRoleKey)');
  const ownerGuard = paymentReconcile.indexOf('.eq("user_id", userId)');
  assert.ok(identity >= 0 && serviceRole > identity && ownerGuard > serviceRole);
});

console.log("Payment gateway identity migration contracts passed.");

test("all migrated user-facing Cloudinary handlers share the fail-closed identity resolver", () => {
  for (const [name, source] of [
    ["get-cloudinary-signature", cloudinarySignature],
    ["cloudinary-delete-asset", cloudinaryDelete],
    ["cloudinary-profile-upload", cloudinaryUpload],
    ["cloudinary-delete-profile", cloudinaryDeleteProfile],
  ]) {
    const executableSource = stripSourceComments(source);
    assert.match(executableSource, /requireApplicationUser\(/, name + " must verify the caller in-handler");
    assert.doesNotMatch(executableSource, /auth\.getUser\(|\/auth\/v1\/user/, name + " must not retain the legacy Supabase Auth verifier");
    assert.doesNotMatch(executableSource, /service_role|SUPABASE_SERVICE_ROLE_KEY/, name + " must not bypass RLS for ownership checks");
  }
  assert.match(cloudinarySignature, /isOwnedCloudinaryPublicId/);
  assert.match(cloudinaryDelete, /isOwnedCloudinaryPublicId/);
  assert.match(cloudinaryDeleteProfile, /isOwnedCloudinaryPublicId/);
});

test("Cloudinary and payment handlers remain compatible with verified third-party issuer routing", () => {
  for (const name of [
    "get-cloudinary-signature",
    "cloudinary-delete-asset",
    "cloudinary-profile-upload",
    "cloudinary-delete-profile",
    "payment-gateway-admin",
    "payment-gateway-create",
    "payment-gateway-reconcile",
    "midtrans-create-payment",
  ]) {
    const section = functionConfig.match(new RegExp("\\[functions\\." + name + "\\]\\s+verify_jwt\\s*=\\s*(true|false)"));
    assert.ok(section, name + " must have an explicit platform gateway JWT policy");
    assert.equal(section[1], "false", name + " must reach its in-handler identity verifier");
  }
  for (const name of ["cloudinary-profile-upload-v2", "cloudinary-delete-asset-v2"]) {
    const section = functionConfig.match(new RegExp("\\[functions\\." + name + "\\]\\s+verify_jwt\\s*=\\s*(true|false)"));
    assert.ok(section, name + " legacy alias must have an explicit gateway policy");
    assert.equal(section[1], "true", name + " remains on its legacy Supabase JWT path until caller deprecation is confirmed");
  }
});

test("payment compatibility delegate forwards the caller token and webhook keeps provider signature auth", () => {
  assert.match(midtransDelegate, /req\.headers\.get\("Authorization"\)/);
  assert.match(midtransDelegate, /\/functions\/v1\/payment-gateway-create/);
  assert.match(midtransDelegate, /"Authorization": authorization/);
  assert.match(paymentWebhook, /INVALID_SIGNATURE|SIGNATURE_REQUIRED/);
  assert.match(paymentWebhook, /constantTimeEqual/);
  assert.doesNotMatch(paymentWebhook, /requireApplicationUser\(/);
});
