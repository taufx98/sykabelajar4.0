import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceRoot = join(repoRoot, "src");
const expected = {
  "src/components/organizer/OrganizerWorkspaceOnboarding.tsx": 4,
  "src/pages/AdminChatConsolePage.tsx": 2,
  "src/services/applicationAccessToken.ts": 1,
  "src/services/auth.service.ts": 8,
  "src/services/chat.service.ts": 3,
};

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(path));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function scanAuthCallsites() {
  const actual = {};
  for (const file of collectSourceFiles(sourceRoot)) {
    const source = readFileSync(file, "utf8");
    const matches = source.match(/\bsupabase\.auth\b/g) ?? [];
    if (matches.length) actual[relative(repoRoot, file).replaceAll("\\", "/")] = matches.length;
  }
  return Object.fromEntries(Object.entries(actual).sort(([a], [b]) => a.localeCompare(b)));
}

test("Stage 4 frontend Supabase Auth inventory matches the reviewed file-by-file baseline", () => {
  const actual = scanAuthCallsites();
  assert.deepEqual(actual, Object.fromEntries(Object.entries(expected).sort(([a], [b]) => a.localeCompare(b))));
  assert.equal(Object.values(actual).reduce((sum, count) => sum + count, 0), 18);
  assert.equal(Object.keys(actual).length, 5);
});

test("the inventory document remains present next to its tracked source baseline", () => {
  const inventoryPath = join(repoRoot, "docs/security/AUTH-FRONTEND-MIGRATION-INVENTORY.md");
  const inventory = readFileSync(inventoryPath, "utf8");
  assert.ok(inventory.includes('17 direct `supabase.auth` callsites across 5 frontend files'));
  assert.match(inventory, /Organizer email\/phone verification/);
  assert.match(inventory, /Cloudinary remains the media system of record/);
  assert.match(inventory, /Legacy private-chat service[\s\S]*not migrate(?: it)? to Better Auth/);
  assert.match(inventory, /comments and other social features remain/);
});

test("Stage 4 registration form matches the Better Auth password and username contract", () => {
  const registrationPage = readFileSync(join(repoRoot, "src/pages/RegisterPage.tsx"), "utf8");
  const betterAuthClient = readFileSync(join(repoRoot, "src/services/betterAuthApi.client.ts"), "utf8");

  assert.ok(registrationPage.includes("const MIN_PASSWORD_LENGTH = 8;"));
  assert.ok(registrationPage.includes("form.password.length>=MIN_PASSWORD_LENGTH"));
  assert.ok(registrationPage.includes("minLength={MIN_PASSWORD_LENGTH}"));
  assert.ok(registrationPage.includes("const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;"));
  assert.ok(registrationPage.includes("USERNAME_PATTERN.test(form.username.trim())"));
  assert.ok(betterAuthClient.includes("const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;"));
  assert.ok(betterAuthClient.includes("if (input.password.length < 8)"));
});
