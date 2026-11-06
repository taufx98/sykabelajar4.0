import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceRoot = join(repoRoot, "src");
const expected = {
  "src/App.tsx": 2,
  "src/components/admin/ZeptoMailSettingsPanel.tsx": 1,
  "src/components/organizer/OrganizerWorkspaceOnboarding.tsx": 4,
  "src/lib/cacheAuthLifecycle.ts": 1,
  "src/pages/AdminChatConsolePage.tsx": 2,
  "src/pages/AdminErrorIntelligencePage.tsx": 2,
  "src/pages/AdminPlanUsagePage.tsx": 1,
  "src/pages/OrganizerControlCenterPage.tsx": 2,
  "src/pages/OrganizerPlanPage.tsx": 1,
  "src/pages/OrdersPage.tsx": 1,
  "src/pages/ProfileInterfaceSettingsPage.tsx": 1,
  "src/pages/RegisterPage.tsx": 1,
  "src/services/ad.service.ts": 3,
  "src/services/auth.service.ts": 7,
  "src/services/chat.service.ts": 3,
  "src/services/cloudinary.service.ts": 1,
  "src/services/commerce.service.ts": 1,
  "src/services/daily-task.service.ts": 1,
  "src/services/organizerAuth.service.ts": 2,
  "src/services/shopEngagement.service.ts": 1,
  "src/services/social.service.ts": 1,
  "src/store/AppContext.tsx": 2,
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
  assert.equal(Object.values(actual).reduce((sum, count) => sum + count, 0), 41);
  assert.equal(Object.keys(actual).length, 22);
});

test("the inventory document remains present next to its tracked source baseline", () => {
  const inventoryPath = join(repoRoot, "docs/security/AUTH-FRONTEND-MIGRATION-INVENTORY.md");
  const inventory = readFileSync(inventoryPath, "utf8");
  assert.match(inventory, /41 direct callsites across 22 frontend files/);
  assert.match(inventory, /Organizer email\/phone verification/);
  assert.match(inventory, /Cloudinary remains the media system of record/);
});
