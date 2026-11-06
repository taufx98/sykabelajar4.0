import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isOwnedCloudinaryPublicId } from "../../supabase/functions/_shared/cloudinary-ownership.mjs";

const endpointPath = fileURLToPath(new URL("../../supabase/functions/get-cloudinary-signature/index.ts", import.meta.url));
const endpoint = readFileSync(endpointPath, "utf8");
const deleteEndpointPath = fileURLToPath(new URL("../../supabase/functions/cloudinary-delete-asset/index.ts", import.meta.url));
const deleteEndpoint = readFileSync(deleteEndpointPath, "utf8");
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

test("the Edge Function uses a pinned Supabase client and derives ownership from verified auth", () => {
  assert.match(endpoint, /npm:@supabase\/supabase-js@2\.57\.4/);
  assert.match(endpoint, /supabase\.auth\.getUser\(\)/);
  assert.match(endpoint, /\.from\("profiles"\)[\s\S]*?\.eq\("id", user\.id\)/);
  assert.match(endpoint, /\.from\("organizers"\)[\s\S]*?\.eq\("owner_user_id", user\.id\)/);
  assert.match(endpoint, /isOwnedCloudinaryPublicId\(publicId/);
  assert.doesNotMatch(endpoint, /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/);
  assert.doesNotMatch(endpoint, /createClient\([^)]*SERVICE_ROLE/);
});

test("the legacy delete-asset endpoint verifies the caller and binds deletes to the caller UUID", () => {
  assert.match(deleteEndpoint, /SUPABASE_URL/);
  assert.match(deleteEndpoint, /\/auth\/v1\/user/);
  assert.match(deleteEndpoint, /Authorization: "Bearer " \+ bearer/);
  assert.match(deleteEndpoint, /const userId = typeof authUser\?\.id === "string" \? authUser\.id : ""/);
  assert.match(deleteEndpoint, /isOwnedCloudinaryPublicId\(publicId, \{ userId \}\)/);
  assert.doesNotMatch(deleteEndpoint, /body\?\.user_id|body\?\.owner_id|user_id\s*\}/);
  assert.match(deleteEndpoint, /FORBIDDEN_PUBLIC_ID/);
  assert.match(deleteEndpoint, /INVALID_RESOURCE_TYPE/);
  assert.match(deleteEndpoint, /CLOUDINARY_API_SECRET/);
  assert.match(deleteEndpoint, /\/destroy/);
  assert.match(supabaseConfig, /\[functions\.cloudinary-delete-asset\][\s\S]*?verify_jwt = true/);
});

test("Cloudinary delete authorization executes before the provider secret and remote destroy call", () => {
  const identity = deleteEndpoint.indexOf('fetch(supabaseUrl + "/auth/v1/user"');
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
