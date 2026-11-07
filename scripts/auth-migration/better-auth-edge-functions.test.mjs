import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const config = read("supabase/config.toml");

const cloudinary = [
  "get-cloudinary-signature",
  "cloudinary-profile-upload",
  "cloudinary-profile-upload-v2",
  "cloudinary-delete-asset",
  "cloudinary-delete-asset-v2",
  "cloudinary-delete-profile",
];

const payment = [
  "payment-gateway-admin",
  "payment-gateway-create",
  "payment-gateway-reconcile",
];

function section(name) {
  const start = config.indexOf("[functions." + name + "]");
  if (start < 0) throw new Error("Missing Supabase function config for " + name);
  const next = config.indexOf("\n[functions.", start + 1);
  return config.slice(start, next < 0 ? config.length : next);
}

for (const name of [...cloudinary, ...payment]) {
  const source = read("supabase/functions/" + name + "/index.ts");
  assert.ok(
    source.includes('import { requireBetterAuthUser } from "../_shared/better-auth-user.ts";'),
    name + " must use the shared Better Auth JWT verifier",
  );
  assert.ok(
    source.includes("requireBetterAuthUser("),
    name + " must authenticate through Better Auth",
  );
  assert.equal(
    /auth\.getUser\(|\/auth\/v1\/user|jwt-decode|jwtDecode\(/i.test(source),
    false,
    name + " must not fall back to Supabase Auth or manual JWT decoding",
  );
  assert.match(section(name), /verify_jwt\s*=\s*true/);
}

const signer = read("supabase/functions/get-cloudinary-signature/index.ts");
assert.ok(signer.includes('.from("profiles")'));
assert.ok(signer.includes('.eq("id", userId)'));
assert.ok(signer.includes('.from("organizers")'));
assert.ok(signer.includes('.eq("owner_user_id", userId)'));
assert.ok(signer.includes("isOwnedCloudinaryPublicId(publicId"));

for (const name of [
  "cloudinary-profile-upload",
  "cloudinary-profile-upload-v2",
]) {
  const source = read("supabase/functions/" + name + "/index.ts");
  assert.ok(source.includes("profile_pictures/user_") && source.includes("identity.userId"));
  assert.ok(source.includes("profile_covers/user_") && source.includes("identity.userId"));
  assert.ok(source.includes("CLOUDINARY_API_SECRET"));
}

for (const name of [
  "cloudinary-delete-asset-v2",
  "cloudinary-delete-profile",
]) {
  const source = read("supabase/functions/" + name + "/index.ts");
  assert.ok(source.includes("profile_pictures/user_") && source.includes("identity.userId"));
  assert.ok(source.includes("profile_covers/user_") && source.includes("identity.userId"));
  assert.ok(source.includes("/destroy"));
}
const genericDelete = read("supabase/functions/cloudinary-delete-asset/index.ts");
assert.ok(genericDelete.includes("isOwnedCloudinaryPublicId(publicId, { userId })"));
assert.ok(genericDelete.includes('new Set(["image"])'));
assert.ok(genericDelete.includes('deliveryType !== "upload"'));

const create = read("supabase/functions/payment-gateway-create/index.ts");
assert.ok(create.includes("const { userId, userEmail } = identity"));
assert.ok(create.includes('.eq("id", orderId).eq("user_id", userId).maybeSingle()'));
assert.ok(create.includes("ORDER_NOT_FOUND"));

const reconcile = read("supabase/functions/payment-gateway-reconcile/index.ts");
assert.ok(reconcile.includes('.eq("id", orderId)'));
assert.ok(reconcile.includes('.eq("user_id", userId)'));
assert.ok(reconcile.includes("Only query the payment intent after the order is confirmed"));
assert.ok(reconcile.includes('.eq("order_id", order.id)'));
assert.ok(reconcile.includes("moneyMatches"));
assert.ok(reconcile.includes("currencyMatches"));
assert.ok(reconcile.includes("process_payment_gateway_success"));

const admin = read("supabase/functions/payment-gateway-admin/index.ts");
const identity = admin.indexOf("requireBetterAuthUser(req)");
const roleCheck = admin.indexOf('authClient.rpc("is_active_admin"');
const privilegedClient = admin.indexOf("createClient(supabaseUrl, serviceRoleKey)");
assert.ok(identity >= 0 && roleCheck > identity && privilegedClient > roleCheck);
assert.ok(admin.includes("updated_by: userId"));
assert.ok(!admin.includes("userData.user.id"));

const midtrans = read("supabase/functions/midtrans-create-payment/index.ts");
assert.ok(midtrans.includes("/functions/v1/payment-gateway-create"));
assert.ok(midtrans.includes('"Authorization": authorization'));
assert.match(section("midtrans-create-payment"), /verify_jwt\s*=\s*true/);

for (const name of ["payment-webhook", "payment-gateway-webhook"]) {
  assert.match(section(name), /verify_jwt\s*=\s*false/);
}
const paymentWebhook = read("supabase/functions/payment-gateway-webhook/index.ts");
assert.ok(paymentWebhook.includes("constantTimeEqual"));
assert.ok(paymentWebhook.includes("sha512"));
assert.ok(paymentWebhook.includes("hmacBase64"));
assert.ok(paymentWebhook.includes("INVALID_SIGNATURE"));

assert.match(section("payment-gateway-public"), /verify_jwt\s*=\s*false/);
console.log("Better Auth Edge Function source contracts passed: six Cloudinary endpoints, three payment endpoints, legacy delegate, and provider/public boundaries.");

const oidcWorkflow = read(".github/workflows/auth-supabase-staging-oidc.yml");
for (const required of [
  "security/auth-poc-stage-1",
  "REGISTER-STAGING-OIDC-0001",
  "REGISTER-STAGING-OIDC-sykabelajar-auth-staging",
  "SUPABASE_ACCESS_TOKEN",
  "ydamszdfsxqisanazdkb",
  "sykabelajar-auth-staging",
  "qdmwatwyyrdjbrvxtcfu",
  "https://auth.sykabelajar.my.id/api/auth",
  "/config/auth/third-party-auth",
  "oidc_issuer_url",
  "auth_config_write",
]) {
  assert.ok(oidcWorkflow.includes(required), "OIDC staging workflow missing " + required);
}
assert.equal(oidcWorkflow.includes("mvdczyitbkxkldjughor"), false);
assert.equal(oidcWorkflow.includes("wrangler deploy"), false);
assert.ok(oidcWorkflow.includes("GET"));
assert.ok(oidcWorkflow.includes("S256"));
assert.ok(oidcWorkflow.includes("ES256"));
assert.ok(oidcWorkflow.includes("production_project_touched: false"));
