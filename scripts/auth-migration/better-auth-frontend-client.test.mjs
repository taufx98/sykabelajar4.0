import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../../src/services/betterAuthApi.client.ts", import.meta.url), "utf8");
const viteEnv = readFileSync(new URL("../../src/vite-env.d.ts", import.meta.url), "utf8");
const appContext = readFileSync(new URL("../../src/store/AppContext.tsx", import.meta.url), "utf8");
const authService = readFileSync(new URL("../../src/services/auth.service.ts", import.meta.url), "utf8");
const callbackPage = readFileSync(new URL("../../src/pages/AuthOidcCallbackPage.tsx", import.meta.url), "utf8");
const accessTokenProvider = readFileSync(new URL("../../src/services/applicationAccessToken.ts", import.meta.url), "utf8");
const authSessionBridge = readFileSync(new URL("../../src/services/auth.service.ts", import.meta.url), "utf8");
const supabaseClient = readFileSync(new URL("../../src/lib/supabase.ts", import.meta.url), "utf8");
const sessionBridge = readFileSync(new URL("../../src/services/betterAuthSessionBridge.mjs", import.meta.url), "utf8");
const cloudinaryService = readFileSync(new URL("../../src/services/cloudinary.service.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8");

assert.match(client, /credentials:\s*'include'/);
assert.match(client, /cache:\s*'no-store'/);
assert.match(client, /\/get-session/);
assert.match(client, /\/oauth2\/authorize/);
assert.match(client, /\/oauth2\/token/);
assert.doesNotMatch(client, /request<unknown>\('\/token'\)/);
assert.match(client, /code_challenge_method: 'S256'/);
assert.match(client, /prompt: 'none'/);
assert.match(client, /resource: SUPABASE_RESOURCE_AUDIENCE/);
assert.match(client, /FIRST_PARTY_OAUTH_CLIENT_ID/);
assert.match(client, /getSupabaseAccessToken\(\)/);
assert.match(client, /payload\.role !== 'authenticated'/);
assert.match(client, /payload\.sub !== userId/);
assert.match(client, /payload\.iss !== expectedIssuer/);
assert.match(client, /payload\.refresh_token/);
assert.doesNotMatch(client, /offline_access/);
assert.match(callbackPage, /postMessage/);
assert.match(callbackPage, /postMessage\(message, window\.location\.origin\)/);
assert.doesNotMatch(callbackPage, /postMessage\(message, ['"]\*['"]\)/);
assert.match(client, /clearResourceTokenCache\(\);\s*return null/);
assert.match(client, /getSupabaseAccessToken\(\)[\s\S]*AUTH_SESSION_EXPIRED/);

assert.match(callbackPage, /sykabelajar-better-auth-oidc/);
assert.match(app, /auth\/oidc\/callback/);
assert.match(client, /\/sign-in\/email/);
assert.match(client, /\/sign-in\/social/);
assert.match(client, /\/sign-up\/email/);
assert.match(client, /\/send-verification-email/);
assert.match(client, /\/request-password-reset/);
assert.match(client, /\/reset-password/);
assert.match(client, /\/change-password/);
assert.match(client, /\/sign-out/);
assert.match(client, /VITE_BETTER_AUTH_FRONTEND_ENABLED !== 'true'/);
assert.match(client, /hostname\.endsWith\('\.pages\.dev'\)/);
assert.match(client, /worker\.hostname === 'auth\.sykabelajar\.my\.id'/);
assert.match(client, /isBetterAuthFrontendEnabledForSupabase\(projectUrl: string\)/);
assert.match(client, /https:\/\/ydamszdfsxqisanazdkb\.supabase\.co/);

assert.match(viteEnv, /VITE_AUTH_WORKER_URL\?: string/);
assert.match(viteEnv, /VITE_BETTER_AUTH_FRONTEND_ENABLED\?: string/);

// The token broker must not create a browser-side persistence path.
assert.equal(client.includes('.localStorage'), false);
assert.equal(client.includes('.sessionStorage'), false);
assert.equal(client.includes('.indexedDB'), false);
assert.match(client, /getResourceToken\(\)/);
assert.match(client, /AUTH_RESOURCE_TOKEN_RESPONSE_INVALID/);

// Only the server-approved self-service account types are accepted.
assert.match(client, /'student', 'teacher', 'organizer'/);
assert.doesNotMatch(client, /'admin'/);
assert.match(client, /USERNAME_PATTERN/);
assert.match(client, /REGISTRATION_USERNAME_INVALID/);

// This is a transport scaffold only: the live app must keep one session source.
assert.match(appContext, /getAuthSession\(\)/);
assert.match(appContext, /onAuthStateChange\(/);
assert.doesNotMatch(appContext, /supabase\.auth/);
assert.match(authService, /signInWithPassword/);
assert.match(authService, /getStagingBetterAuthClient\(\)\.signInWithEmail/);
assert.match(authService, /createBetterAuthSessionBridge/);
assert.match(sessionBridge, /sykabelajar-better-auth-session/);
assert.doesNotMatch(sessionBridge, /access_token|refresh_token/);
assert.match(supabaseClient, /createSupabaseClientOptions/);
assert.match(supabaseClient, /getSupabaseAccessToken\(\)/);
assert.match(supabaseClient, /isBetterAuthFrontendEnabled\(\)/);
assert.doesNotMatch(appContext, /getStagingBetterAuthClient/);
assert.match(accessTokenProvider, /isBetterAuthFrontendEnabled\(\)/);
assert.match(accessTokenProvider, /getStagingBetterAuthClient\(\)\.getSupabaseAccessToken\(\)/);
assert.match(accessTokenProvider, /supabase\.auth\.getSession\(\)/);
assert.match(cloudinaryService, /getSupabaseResourceAccessToken\(\)/);
assert.doesNotMatch(cloudinaryService, /supabase\.auth/);


console.log("Better Auth frontend transport contract passed; Supabase Auth remains the sole live app session source.");
