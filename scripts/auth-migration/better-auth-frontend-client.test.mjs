import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../../src/services/betterAuthApi.client.ts", import.meta.url), "utf8");
const organizerOnboarding = readFileSync(new URL("../../src/components/organizer/OrganizerWorkspaceOnboarding.tsx", import.meta.url), "utf8");
const authWorker = readFileSync(new URL("../../services/auth-worker/src/worker.ts", import.meta.url), "utf8");
const viteEnv = readFileSync(new URL("../../src/vite-env.d.ts", import.meta.url), "utf8");
const appContext = readFileSync(new URL("../../src/store/AppContext.tsx", import.meta.url), "utf8");
const authService = readFileSync(new URL("../../src/services/auth.service.ts", import.meta.url), "utf8");
const callbackPage = readFileSync(new URL("../../src/pages/AuthOidcCallbackPage.tsx", import.meta.url), "utf8");
const resetPasswordPage = readFileSync(new URL("../../src/pages/ResetPasswordPage.tsx", import.meta.url), "utf8");
const emailVerifiedPage = readFileSync(new URL("../../src/pages/AuthEmailVerifiedPage.tsx", import.meta.url), "utf8");
const accessTokenProvider = readFileSync(new URL("../../src/services/applicationAccessToken.ts", import.meta.url), "utf8");
const authSessionBridge = readFileSync(new URL("../../src/services/auth.service.ts", import.meta.url), "utf8");
const supabaseClient = readFileSync(new URL("../../src/lib/supabase.ts", import.meta.url), "utf8");
const sessionBridge = readFileSync(new URL("../../src/services/betterAuthSessionBridge.mjs", import.meta.url), "utf8");
const cloudinaryService = readFileSync(new URL("../../src/services/cloudinary.service.ts", import.meta.url), "utf8");
const profileSettingsPage = readFileSync(new URL("../../src/pages/ProfileInterfaceSettingsPage.tsx", import.meta.url), "utf8");
const adminPage = readFileSync(new URL("../../src/pages/AdminPage.tsx", import.meta.url), "utf8");
const zeptoMailPanel = readFileSync(new URL("../../src/components/admin/ZeptoMailSettingsPanel.tsx", import.meta.url), "utf8");
const loginProvidersPanel = readFileSync(new URL("../../src/components/admin/LoginProvidersSettingsPanel.tsx", import.meta.url), "utf8");
const socialProviderSettings = readFileSync(new URL("../../services/auth-worker/src/social-provider-settings.ts", import.meta.url), "utf8");

const app = readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8");
const loginPage = readFileSync(new URL("../../src/pages/LoginPage.tsx", import.meta.url), "utf8");
const registerPage = readFileSync(new URL("../../src/pages/RegisterPage.tsx", import.meta.url), "utf8");


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
assert.match(client, /AUTH_SESSION_CHANGED_DURING_TOKEN_REQUEST/);
assert.match(
  client,
  /const latestSession = await readSessionPayload\(\);[\s\S]*latestSession\.user\.id !== userId[\s\S]*latestSession\.user\.emailVerified !== true[\s\S]*cachedResourceToken =/,
);

assert.match(callbackPage, /sykabelajar-better-auth-oidc/);
assert.match(app, /auth\/oidc\/callback/);
assert.match(client, /\/sign-in\/email/);
assert.ok(client.includes("const workerOrigin = baseUrl.replace(/\\/api\\/auth$/, '');"));

assert.match(client, /\/sign-in\/social/);
assert.match(client, /\/sign-up\/email/);
assert.match(client, /\/send-verification-email/);
assert.match(client, /\/request-password-reset/);
assert.match(client, /\/reset-password/);
assert.match(client, /\/change-password/);
assert.match(client, /\/sign-out/);
assert.match(client, /VITE_BETTER_AUTH_FRONTEND_ENABLED !== 'true'/);
assert.match(client, /hostname === 'staging\.sykabelajar\.my\.id'/);
assert.doesNotMatch(client, /hostname\.endsWith\('\.pages\.dev'\)/);
assert.match(client, /resolveOAuthCallbackUrl\(\)/);
assert.match(client, /ALLOWED_OAUTH_CALLBACK_ORIGINS/);
assert.match(client, /event\.origin !== callbackOrigin/);
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

assert.match(client, /getTelegramPhoneVerificationStatus\(\)/);
assert.match(client, /startTelegramPhoneVerification\(\)/);
assert.match(client, /\/api\/phone-verification\/telegram\/status/);
assert.match(client, /\/api\/phone-verification\/telegram\/start/);
assert.match(client, /authorizationUrl\.origin !== 'https:\/\/oauth\.telegram\.org'/);
assert.match(organizerOnboarding, /isBetterAuthEnabled\(\)/);
assert.match(organizerOnboarding, /getTelegramPhoneVerificationStatus\(\)/);
assert.match(organizerOnboarding, /startTelegramPhoneVerification\(\)/);
assert.match(organizerOnboarding, /supabase\.auth\.verifyOtp/);
assert.match(authWorker, /url\.pathname === "\/api\/phone-verification\/telegram\/status"/);
assert.match(authWorker, /getSupabasePhoneVerificationStatus\(env, userId\)/);
const phoneStatusHandler = authWorker.slice(
  authWorker.indexOf("async function getTelegramPhoneVerificationStatus"),
  authWorker.indexOf("async function completeTelegramPhoneCallback"),
);
assert.match(phoneStatusHandler, /const session = await auth\.api\.getSession\(\{ headers: request\.headers \}\)/);
assert.match(phoneStatusHandler, /const userId = session\?\.user\?\.id/);
assert.match(phoneStatusHandler, /if \(!corsHeaders\)/);
assert.doesNotMatch(phoneStatusHandler, /request\.json\(|searchParams\.get\(/);

assert.match(authWorker, /new URL\("\/organizer", app\.origin\)/);

// This is a transport scaffold only: the live app must keep one session source.
assert.match(appContext, /getAuthSession\(\)/);
assert.match(appContext, /onAuthStateChange\(/);
assert.doesNotMatch(appContext, /supabase\.auth/);
assert.match(authService, /signInWithPassword/);
assert.match(authService, /const client = getStagingBetterAuthClient\(\);[\s\S]*?client\.signInWithEmail\(/);
assert.match(authService, /isBetterAuthFrontendEnabledForSupabase\(env\.supabaseUrl\)/);
assert.match(authService, /createBetterAuthSessionBridge/);
assert.match(authService, /export function isBetterAuthEnabled\(\)/);
assert.match(authService, /export async function updatePassword\(newPassword: string, currentPassword\?: string\)/);
assert.match(authService, /changePassword\(currentPassword, newPassword, true\)/);
assert.match(authService, /const redirectPath = resolveSafeInternalRedirect\([\s\S]*?redirectTo \?\? '\/reset-password'/);
assert.match(authService, /new URL\(redirectPath, window\.location\.origin\)/);
assert.match(authService, /export async function completePasswordReset\(token: string, newPassword: string\)/);
assert.match(authService, /callbackURL: new URL\('\/auth\/verified', window\.location\.origin\)\.toString\(\)/);
assert.match(authService, /new URL\('\/auth\/verified', window\.location\.origin\)/);
assert.match(client, /callbackURL\?: string/);
assert.match(client, /\? \{ callbackURL: input\.callbackURL \} : \{\}/);
assert.match(emailVerifiedPage, /getSession\(\)/);
assert.match(emailVerifiedPage, /session\?\.user\.emailVerified === true/);
assert.doesNotMatch(emailVerifiedPage, /searchParams\.get\('status'\).*verified|params\.get\('status'\).*verified/);
assert.match(emailVerifiedPage, /window\.history\.replaceState/);
assert.match(app, /path="\/auth\/verified"/);

assert.match(authService, /export async function sendVerificationEmail\(email: string, callbackURL\?: string\)/);
assert.match(authService, /getStagingBetterAuthClient\(\)\.sendVerificationEmail\(normalizedEmail, destination\)/);
assert.match(authService, /supabase\.auth\.resend\(\{[\s\S]*?type: 'signup'[\s\S]*?emailRedirectTo: destination/);
assert.match(loginPage, /sendVerificationEmail/);
assert.match(loginPage, /handleResendVerification/);
assert.match(loginPage, /EMAIL_VERIFICATION_REQUIRED\|EMAIL_NOT_VERIFIED\|EMAIL_NOT_CONFIRMED/);
assert.match(loginPage, /If that address has an unverified account, a verification link will be sent\./);
assert.match(registerPage, /isBetterAuthEnabled\(\)/);
assert.match(registerPage, /Akun berhasil dibuat\. Periksa email untuk menyelesaikan verifikasi sebelum masuk\./);

assert.match(authService, /getStagingBetterAuthClient\(\)\.resetPassword\(token, newPassword\)/);
assert.match(authService, /supabase\.auth\.updateUser\(\{ password: newPassword \}\)/);
assert.match(resetPasswordPage, /new URLSearchParams\(window\.location\.search\)\.get\('token'\)/);
assert.match(resetPasswordPage, /searchParams\.delete\('token'\)/);
assert.match(resetPasswordPage, /completePasswordReset\(token, password\)/);
assert.match(resetPasswordPage, /Setelah berhasil, masuk kembali menggunakan password baru\./);
assert.doesNotMatch(resetPasswordPage, /semua sesi lama akan dicabut/i);

assert.match(resetPasswordPage, /password\.length < 8/);
assert.match(app, /path="\/reset-password"/);

assert.match(authService, /supabase\.auth\.updateUser\(\{ password: newPassword \}\)/);
assert.match(client, /async changePassword\(currentPassword, newPassword, revokeOtherSessions = true\)[\s\S]*?await request<unknown>\('\/change-password'[\s\S]*?clearResourceTokenCache\(\);/);
assert.match(profileSettingsPage, /isBetterAuthEnabled, updatePassword as updateAccountPassword/);
assert.match(profileSettingsPage, /updateAccountPassword\(password, requiresCurrentPassword \? currentPassword : undefined\)/);
assert.match(profileSettingsPage, /autoComplete="current-password"/);
assert.doesNotMatch(profileSettingsPage, /supabase\.auth/);
assert.match(adminPage, /import \{ ZeptoMailSettingsPanel \} from '@\/components\/admin\/ZeptoMailSettingsPanel'/);
assert.match(adminPage, /tab === 'settings'[\s\S]*?<ZeptoMailSettingsPanel\s*\/>/);
assert.match(zeptoMailPanel, /const EMPTY_DRAFT:[\s\S]*?provider: 'zeptomail'/);
assert.match(zeptoMailPanel, /<option value="zeptomail">ZeptoMail · utama<\/option>/);
assert.match(zeptoMailPanel, /<option value="brevo">Brevo Free · cadangan/);
assert.match(zeptoMailPanel, /request\('activate'/);
assert.match(zeptoMailPanel, /request\('test'/);
assert.match(zeptoMailPanel, /request\('delete'/);
assert.match(sessionBridge, /sykabelajar-better-auth-session/);
assert.doesNotMatch(sessionBridge, /access_token|refresh_token/);
assert.match(supabaseClient, /createSupabaseClientOptions/);
assert.match(supabaseClient, /getSupabaseAccessToken\(\)/);
assert.match(supabaseClient, /isBetterAuthFrontendEnabledForSupabase\(env\.supabaseUrl\)/);
assert.doesNotMatch(appContext, /getStagingBetterAuthClient/);
assert.match(accessTokenProvider, /isBetterAuthFrontendEnabledForSupabase\(env\.supabaseUrl\)/);
assert.match(accessTokenProvider, /getStagingBetterAuthClient\(\)\.getSupabaseAccessToken\(\)/);
assert.match(accessTokenProvider, /supabase\.auth\.getSession\(\)/);
assert.match(cloudinaryService, /getSupabaseResourceAccessToken\(\)/);
assert.doesNotMatch(cloudinaryService, /supabase\.auth/);



const settingsTabIndex = adminPage.indexOf("tab === 'settings'");
assert.ok(settingsTabIndex >= 0);
const settingsTab = adminPage.slice(settingsTabIndex, settingsTabIndex + 650);
assert.match(settingsTab, /<LoginProvidersSettingsPanel\s*\/>/);
assert.match(settingsTab, /<ZeptoMailSettingsPanel\s*\/>/);

assert.match(loginProvidersPanel, /const PROVIDER_ORDER: BetterAuthSocialProvider\[\] = \['google', 'facebook', 'twitter'\]/);
assert.match(loginProvidersPanel, /Google \/ Gmail/);
assert.match(loginProvidersPanel, /Facebook/);
assert.match(loginProvidersPanel, /X \/ Twitter/);
assert.match(loginProvidersPanel, /Instagram/);
assert.match(loginProvidersPanel, /Badge>Unavailable<\/Badge/);
assert.match(loginProvidersPanel, /settings\.instagram\.reason/);
assert.match(loginProvidersPanel, /Tidak ada tombol aktivasi atau workaround/);
assert.match(loginProvidersPanel, /const previewEnabled = isBetterAuthEnabled\(\)/);
assert.match(loginProvidersPanel, /clientSecret: ''/);
assert.match(loginProvidersPanel, /draft\.clientSecret\.trim\(\) \? \{ clientSecret: draft\.clientSecret\.trim\(\) \} : \{\}/);

assert.match(socialProviderSettings, /export const SOCIAL_LOGIN_PROVIDERS = \["google", "facebook", "twitter"\]/);
assert.match(socialProviderSettings, /instagram:\s*\{ available: false/);
assert.match(socialProviderSettings, /const authorization = await requireBetterAuthAdmin\(request, env\)/);
assert.match(zeptoMailPanel, /sendMailToken: ''/);
assert.match(zeptoMailPanel, /getSupabaseResourceAccessToken\(\)/);
assert.match(zeptoMailPanel, /AUTH_WORKER_URL_NOT_CONFIGURED/);

// Refresh/focus checks must reuse a still-valid resource token, and all
// session/status reads must be deduplicated and recover from transient GETs.
assert.match(client, /EMAIL_VERIFICATION_POLICY_CACHE_MS = 15_000/);
assert.match(client, /sessionReadInFlight/);
assert.match(client, /const pending = request<unknown>\('\/get-session'\)/);
assert.match(client, /safeRead && \(response\.status === 429 \|\| response\.status >= 500\)/);
assert.match(client, /if \(!safeRead \|\| attempt === 2\)/);
assert.match(authSessionBridge, /onSessionChanged: \(\) => client\.invalidateResourceTokenCache\(\)/);
assert.doesNotMatch(sessionBridge, /onBeforeRefresh/);
assert.match(sessionBridge, /input\.onSessionChanged\?\.\(\)/);
assert.match(appContext, /AUTH_READ_RETRY_DELAYS_MS = \[150, 400\]/);
assert.match(appContext, /retryTransientAuthRead\(\(\) => getAuthSession\(\)\)/);
assert.match(appContext, /isDefinitiveAuthRejection\(error\) \|\| isDefinitiveIdentityFailure\(error\)/);
assert.match(appContext, /setAuthUnavailable\(true\)/);
assert.match(appContext, /retryAuthSession/);
assert.match(app, /authUnavailable, retryAuthSession/);
assert.match(app, /Sesi belum dinyatakan berakhir/);

console.log("Better Auth frontend transport contract passed; Supabase Auth remains the sole live app session source.");
