import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isOwnedCloudinaryPublicId } from "../../supabase/functions/_shared/cloudinary-ownership.mjs";

const endpointPath = fileURLToPath(new URL("../../supabase/functions/get-cloudinary-signature/index.ts", import.meta.url));
const endpoint = readFileSync(endpointPath, "utf8");
const identityResolver = readFileSync(new URL("../../supabase/functions/_shared/require-application-user.ts", import.meta.url), "utf8");
const deleteEndpointPath = fileURLToPath(new URL("../../supabase/functions/cloudinary-delete-asset/index.ts", import.meta.url));
const deleteEndpoint = readFileSync(deleteEndpointPath, "utf8");
const profileUploadPath = fileURLToPath(new URL("../../supabase/functions/cloudinary-profile-upload/index.ts", import.meta.url));
const profileUploadEndpoint = readFileSync(profileUploadPath, "utf8");
const profileUploadV2Endpoint = readFileSync(
  new URL("../../supabase/functions/cloudinary-profile-upload-v2/index.ts", import.meta.url),
  "utf8",
);
const profileDeletePath = fileURLToPath(new URL("../../supabase/functions/cloudinary-delete-profile/index.ts", import.meta.url));
const profileDeleteEndpoint = readFileSync(profileDeletePath, "utf8");
const supabaseConfig = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");

test("legacy UUID-based avatar and cover assets are limited to the authenticated UUID", () => {
  const identity = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  assert.equal(isOwnedCloudinaryPublicId("profile_pictures/user_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", identity), true);
  assert.equal(isOwnedCloudinaryPublicId("profile_covers/user_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", identity), true);
  assert.equal(isOwnedCloudinaryPublicId("profile_pictures/user_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", identity), false);
  assert.equal(isOwnedCloudinaryPublicId("profile_covers/user_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", identity), false);
  assert.equal(isOwnedCloudinaryPublicId("profile_pictures/user_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/extra", identity), false);
});

test("a user can sign only their canonical avatar and cover assets", () => {
  const identity = { username: "alice_1", ownedOrganizers: [] };
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/alice_1/profile", identity), true);
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/alice_1/cover", identity), true);
});

test("legacy mixed-case usernames keep their exact Cloudinary public ID namespace", () => {
  const identity = { username: "Legacy.User_1", ownedOrganizers: [] };
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/Legacy.User_1/profile", identity), true);
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/legacy.user_1/profile", identity), false);
});

test("a user cannot sign another user's profile or cover namespace", () => {
  const identity = { username: "alice_1", ownedOrganizers: [] };
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/bob/profile", identity), false);
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/bob/cover", identity), false);
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/alice_10/profile", identity), false);
});

test("a username from the request is not accepted as identity", () => {
  // The function receives only the username resolved from the caller-owned
  // profile row; a body-supplied username is never part of this contract.
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/bob/profile", { username: "alice" }), false);
});

test("a user may sign the logo for an organizer they own by slug or UUID", () => {
  const identity = {
    username: "alice",
    ownedOrganizers: [{ id: "123e4567-e89b-12d3-a456-426614174000", slug: "alice-school" }],
  };
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/organizers/alice-school/profile", identity), true);
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/organizers/123e4567-e89b-12d3-a456-426614174000/profile", identity), true);
});

test("a user cannot sign an organizer logo they do not own", () => {
  const identity = {
    username: "alice",
    ownedOrganizers: [{ id: "123e4567-e89b-12d3-a456-426614174000", slug: "alice-school" }],
  };
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/organizers/bob-school/profile", identity), false);
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/organizers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/profile", identity), false);
});

test("only the expected profile/cover/organizer asset types can be signed", () => {
  const identity = {
    username: "alice",
    ownedOrganizers: [{ id: "123e4567-e89b-12d3-a456-426614174000", slug: "alice-school" }],
  };
  for (const publicId of [
    "sykabelajar/alice/private",
    "sykabelajar/alice/profile/extra",
    "sykabelajar/organizers/alice-school/cover",
    "sykabelajar/organizers/alice-school/private",
    "sykabelajar/products/product-1",
  ]) {
    assert.equal(isOwnedCloudinaryPublicId(publicId, identity), false, publicId);
  }
});

test("malformed, traversal, encoded and oversized public IDs are rejected", () => {
  const identity = {
    username: "alice",
    ownedOrganizers: [{ id: "123e4567-e89b-12d3-a456-426614174000", slug: "alice-school" }],
  };
  for (const publicId of [
    "",
    "sykabelajar/alice/../bob/profile",
    "sykabelajar//alice/profile",
    "/sykabelajar/alice/profile",
    "sykabelajar/alice/profile/",
    "sykabelajar%2Falice%2Fprofile",
    "sykabelajar/alice/profile?overwrite=true",
    "sykabelajar/alice/profile&folder=other",
    "x".repeat(241),
  ]) {
    assert.equal(isOwnedCloudinaryPublicId(publicId, identity), false, publicId);
  }
});

test("missing profile identity or owned-organizer collection fails closed", () => {
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/alice/profile", {}), false);
  assert.equal(isOwnedCloudinaryPublicId("sykabelajar/organizers/alice-school/profile", {
    username: "alice",
    ownedOrganizers: null,
  }), false);
});

test("the new username-based signer passes the verified UUID for legacy assets", () => {
  assert.match(endpoint, /isOwnedCloudinaryPublicId\(publicId, \{ userId, username: profile\.username, ownedOrganizers \}\)/);
});

test("the shared identity resolver defaults to legacy Supabase Auth and only opts into Better Auth explicitly", () => {
  assert.match(identityResolver, /AUTH_IDENTITY_MODE/);
  assert.match(identityResolver, /\?\.trim\(\) \|\| "supabase"/);
  assert.match(identityResolver, /mode === "better-auth"/);
  assert.match(identityResolver, /requireBetterAuthUser\(request\)/);
  assert.match(identityResolver, /supabase\.auth\.getUser\(\)/);
  assert.match(identityResolver, /AUTH_IDENTITY_MODE_INVALID/);
  assert.doesNotMatch(identityResolver, /SERVICE_ROLE_KEY|service_role/i);
});

test("the frontend Cloudinary delete-profile endpoint derives caller-owned username and UUID namespaces", () => {
  assert.match(profileDeleteEndpoint, /requireApplicationUser\(request\)/);
  assert.match(profileDeleteEndpoint, /UUID_PATTERN\.test\(userId\)/);
  assert.match(profileDeleteEndpoint, /identity\.supabase[\s\S]*?from\("profiles"\)[\s\S]*?select\("username"\)[\s\S]*?eq\("id", userId\)/);
  assert.match(profileDeleteEndpoint, /isOwnedCloudinaryPublicId\(publicId, \{ userId, username: profile\.username \}\)/);
  assert.match(profileDeleteEndpoint, /PROFILE_NOT_FOUND/);
  assert.match(profileDeleteEndpoint, /FORBIDDEN_PUBLIC_ID/);
  assert.match(profileDeleteEndpoint, /resourceType !== "image"/);
  assert.match(profileDeleteEndpoint, /\/image\/destroy/);
  assert.match(profileDeleteEndpoint, /AbortSignal\.timeout\(8000\)/);
  assert.doesNotMatch(profileDeleteEndpoint, /body\??\.user_id|body\??\.owner_id|body\??\.userId|body\??\.username/);
  assert.match(supabaseConfig, /\[functions\.cloudinary-delete-profile\][\s\S]*?verify_jwt = false/);
  const identity = profileDeleteEndpoint.indexOf("requireApplicationUser(request)");
  const profileLookup = profileDeleteEndpoint.indexOf('.from("profiles")');
  const ownerGuard = profileDeleteEndpoint.indexOf("isOwnedCloudinaryPublicId(publicId");
  const secretRead = profileDeleteEndpoint.indexOf('requiredEnv("CLOUDINARY_API_SECRET")');
  const providerCall = profileDeleteEndpoint.indexOf("/image/destroy");
  assert.ok(identity >= 0 && profileLookup > identity && ownerGuard > profileLookup && secretRead > ownerGuard && providerCall > secretRead);
});

test("Cloudinary profile upload uses the shared verified identity and derives UUID-owned asset IDs", () => {
  assert.match(profileUploadEndpoint, /requireApplicationUser\(req\)/);
  assert.match(profileUploadEndpoint, /const userId\s*=\s*identity\.userId/);
  assert.match(profileUploadEndpoint, /profile_pictures\/user_\$\{userId\}/);
  assert.match(profileUploadEndpoint, /profile_covers\/user_\$\{userId\}/);
  assert.match(profileUploadEndpoint, /file\.size\s*>\s*5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(profileUploadEndpoint, /kind\s*!==\s*"profile"\s*&&\s*kind\s*!==\s*"cover"/);
  assert.doesNotMatch(profileUploadEndpoint, /body\.user_id|body\.owner_id|form\.get\(["']user_id/);
  assert.match(profileUploadEndpoint, /CLOUDINARY_API_SECRET/);
  assert.match(profileUploadEndpoint, /image\/upload/);
  assert.match(supabaseConfig, /\[functions\.cloudinary-profile-upload\][\s\S]*?verify_jwt = false/);
});

test("the Cloudinary signer uses the shared verified identity and caller-scoped ownership reads", () => {
  assert.match(endpoint, /requireApplicationUser\(req\)/);
  assert.match(endpoint, /\.from\("profiles"\)[\s\S]*?\.eq\("id", userId\)/);
  assert.match(endpoint, /\.from\("organizers"\)[\s\S]*?\.eq\("owner_user_id", userId\)/);
  assert.match(endpoint, /isOwnedCloudinaryPublicId\(publicId/);
  assert.doesNotMatch(endpoint, /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/);
  assert.doesNotMatch(endpoint, /createClient\([^)]*SERVICE_ROLE/);
});

test("the delete endpoint uses the shared verifier and binds assets to its verified UUID", () => {
  assert.match(deleteEndpoint, /requireApplicationUser\(request\)/);
  assert.match(identityResolver, /SUPABASE_URL/);
  assert.match(identityResolver, /supabase\.auth\.getUser\(\)/);
  assert.match(deleteEndpoint, /isOwnedCloudinaryPublicId\(publicId, \{ userId \}\)/);
  assert.doesNotMatch(deleteEndpoint, /body\?\.user_id|body\?\.owner_id|user_id\s*\}/);
  assert.match(deleteEndpoint, /FORBIDDEN_PUBLIC_ID/);
  assert.match(deleteEndpoint, /INVALID_RESOURCE_TYPE/);
  assert.match(deleteEndpoint, /RESOURCE_TYPES = new Set\(\["image"\]\)/);
  assert.doesNotMatch(deleteEndpoint, /new Set\(\["image", "video", "raw"\]\)/);
  assert.match(deleteEndpoint, /METHOD_NOT_ALLOWED/);
  assert.match(deleteEndpoint, /request.method === "OPTIONS"/);
  assert.match(deleteEndpoint, /access-control-allow-origin/);
  assert.match(deleteEndpoint, /CLOUDINARY_API_SECRET/);
  assert.match(identityResolver, /AbortSignal.timeout\(5000\)/);
  assert.match(deleteEndpoint, /AbortSignal.timeout\(8000\)/);
  assert.match(deleteEndpoint, /\/destroy/);
  assert.match(supabaseConfig, /\[functions\.cloudinary-delete-asset\][\s\S]*?verify_jwt = false/);
});

test("Cloudinary delete authorization executes before the provider secret and remote destroy call", () => {
  const identity = deleteEndpoint.indexOf("requireApplicationUser(request)");
  const ownership = deleteEndpoint.indexOf("isOwnedCloudinaryPublicId(publicId");
  const secret = deleteEndpoint.indexOf('requiredEnv("CLOUDINARY_API_SECRET")');
  const destroy = deleteEndpoint.indexOf("/destroy");
  assert.ok(identity >= 0 && ownership > identity && secret > ownership && destroy > secret);
});

test("ownership checks happen before Cloudinary credentials are used to create a signature", () => {
  const ownerCheck = endpoint.indexOf("isOwnedCloudinaryPublicId(publicId");
  const signingSecret = endpoint.indexOf('Deno.env.get("CLOUDINARY_API_SECRET")');
  const signature = endpoint.indexOf("crypto.subtle.digest");
  assert.ok(ownerCheck >= 0 && signingSecret > ownerCheck && signature > signingSecret);
});


test("both Cloudinary profile upload endpoints handle bearer CORS preflight before auth", () => {
  for (const [name, source] of [
    ["cloudinary-profile-upload", profileUploadEndpoint],
    ["cloudinary-profile-upload-v2", profileUploadV2Endpoint],
  ]) {
    assert.match(source, /Access-Control-Allow-Origin/);
    assert.match(source, /Access-Control-Allow-Headers[^\n]*authorization[^\n]*content-type/i);
    assert.match(source, /Access-Control-Allow-Methods[^\n]*POST[^\n]*OPTIONS/i);
    assert.match(source, /req\.method === "OPTIONS"/);
    assert.match(source, /status: 204/);
    const preflight = source.indexOf('if (req.method === "OPTIONS")');
    const identity = source.indexOf("requireApplicationUser(req)");
    assert.ok(preflight >= 0 && identity > preflight, name + " must answer browser preflight before verifying the bearer token");
    assert.match(source, /req\.method !== "POST"/);
    assert.match(source, /file\.size\s*>\s*5\s*\*\s*1024\s*\*\s*1024/);
    assert.match(source, /kind !== "profile" && kind !== "cover"/);
    assert.match(source, /AbortSignal\.timeout\(12_000\)/);
    assert.match(source, /redirect: "error"/);
    assert.match(source, /CLOUDINARY_UPLOAD_FAILED/);
    assert.match(source, /CLOUDINARY_UPLOAD_NOT_CONFIGURED/);
    assert.doesNotMatch(source, /body\.get\(["']user_id["']\)|body\.get\(["']owner_id["']\)/);
  }
  assert.match(supabaseConfig, /\[functions\.cloudinary-profile-upload\][\s\S]*?verify_jwt = false/);
  assert.match(supabaseConfig, /\[functions\.cloudinary-profile-upload-v2\][\s\S]*?verify_jwt = false/);
});

test("V2 Cloudinary profile upload preserves its legacy response shape", () => {
  assert.match(profileUploadV2Endpoint, /asset_id: result\.asset_id/);
  assert.match(profileUploadV2Endpoint, /kind,/);
  assert.doesNotMatch(profileUploadV2Endpoint, /user_id:\s*userId/);
  assert.match(profileUploadEndpoint, /user_id:\s*userId/);
});
