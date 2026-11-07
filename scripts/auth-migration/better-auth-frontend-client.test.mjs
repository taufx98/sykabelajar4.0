import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../../src/services/betterAuthApi.client.ts", import.meta.url), "utf8");
const viteEnv = readFileSync(new URL("../../src/vite-env.d.ts", import.meta.url), "utf8");
const appContext = readFileSync(new URL("../../src/store/AppContext.tsx", import.meta.url), "utf8");
const authService = readFileSync(new URL("../../src/services/auth.service.ts", import.meta.url), "utf8");

assert.match(client, /credentials:\s*'include'/);
assert.match(client, /cache:\s*'no-store'/);
assert.match(client, /\/get-session/);
assert.match(client, /\/token/);
assert.match(client, /\/sign-in\/email/);
assert.match(client, /\/sign-in\/social/);
assert.match(client, /\/sign-up\/email/);
assert.match(client, /\/sign-out/);
assert.match(client, /VITE_BETTER_AUTH_FRONTEND_ENABLED === 'true'/);
assert.match(viteEnv, /VITE_AUTH_WORKER_URL\?: string/);
assert.match(viteEnv, /VITE_BETTER_AUTH_FRONTEND_ENABLED\?: string/);

// The token broker must not create a browser-side persistence path.
assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/i);
assert.match(client, /getResourceToken\(\)/);
assert.match(client, /AUTH_RESOURCE_TOKEN_RESPONSE_INVALID/);

// Only the server-approved self-service account types are accepted.
assert.match(client, /'student', 'teacher', 'organizer'/);
assert.doesNotMatch(client, /'admin'/);
assert.match(client, /USERNAME_PATTERN/);
assert.match(client, /REGISTRATION_USERNAME_INVALID/);

// This is a transport scaffold only: the live app must keep one session source.
assert.match(appContext, /supabase\.auth\.getSession\(\)/);
assert.match(appContext, /supabase\.auth\.onAuthStateChange/);
assert.match(authService, /supabase\.auth\.signInWithPassword/);
assert.doesNotMatch(appContext, /getStagingBetterAuthClient/);

console.log("Better Auth frontend transport contract passed; Supabase Auth remains the sole live app session source.");
