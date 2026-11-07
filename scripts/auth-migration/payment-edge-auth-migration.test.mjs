import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const edgeRoot = new URL("../../supabase/functions/", import.meta.url);
const identityResolver = readFileSync(new URL("_shared/require-application-user.ts", edgeRoot), "utf8");
const paymentAdmin = readFileSync(new URL("payment-gateway-admin/index.ts", edgeRoot), "utf8");
const paymentCreate = readFileSync(new URL("payment-gateway-create/index.ts", edgeRoot), "utf8");
const paymentReconcile = readFileSync(new URL("payment-gateway-reconcile/index.ts", edgeRoot), "utf8");

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
