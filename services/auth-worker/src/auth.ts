import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import type { AuthWorkerEnv } from "./env";
import { sendAuthEmail } from "./email";
import { APIError } from "better-auth/api";
import {
  completeSupabaseEmailVerification,
  isSupabaseProvisioningEnabled,
  reconcileSupabaseApplicationIdentity,
} from "./supabase-provisioning.mjs";

function requireHttpsOrigin(value: string, label: string, allowLocalhost = false): string {
  const url = new URL(value);
  const isLocalhost = allowLocalhost && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  const protocolAllowed = url.protocol === "https:" || (isLocalhost && url.protocol === "http:");
  if (!protocolAllowed || url.origin !== value.replace(/\/$/, "")) {
    throw new Error(label + "_MUST_BE_AN_ORIGIN");
  }
  return url.origin;
}

export function createAuth(env: AuthWorkerEnv) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET_MUST_BE_AT_LEAST_32_CHARACTERS");
  }

  const appOrigin = requireHttpsOrigin(env.APP_ORIGIN, "APP_ORIGIN");
  const baseUrl = requireHttpsOrigin(env.BETTER_AUTH_URL, "BETTER_AUTH_URL", true);
  const resourceAudience = requireHttpsOrigin(
    env.SUPABASE_RESOURCE_AUDIENCE,
    "SUPABASE_RESOURCE_AUDIENCE",
  );
  const trustedOrigins = [appOrigin];

  if (env.DEV_APP_ORIGIN) {
    trustedOrigins.push(requireHttpsOrigin(env.DEV_APP_ORIGIN, "DEV_APP_ORIGIN", true));
  }

  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error("GOOGLE_OAUTH_REQUIRES_BOTH_CLIENT_ID_AND_CLIENT_SECRET");
  }

  const socialProviders = googleClientId && googleClientSecret
    ? {
        google: {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
          requireEmailVerification: true,
        },
      }
    : undefined;

  return betterAuth({
    appName: "SYKABELAJAR",
    baseURL: baseUrl,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail(env, {
          to: user.email,
          subject: "Atur ulang password SYKABELAJAR",
          text: "Gunakan tautan berikut untuk mengatur ulang password Anda: " + url + "\n\nJika Anda tidak meminta pengaturan ulang password, abaikan email ini.",
          action: "reset-password",
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      afterEmailVerification: async (user) => {
        if (!isSupabaseProvisioningEnabled(env)) return;
        await completeSupabaseEmailVerification(env, user);
      },
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail(env, {
          to: user.email,
          subject: "Verifikasi email SYKABELAJAR",
          text: "Verifikasi alamat email Anda melalui tautan berikut: " + url + "\n\nJika Anda tidak membuat akun SYKABELAJAR, abaikan email ini.",
          action: "verify-email",
        });
      },
    },
    socialProviders,
    user: {
      additionalFields: {
        accountType: {
          type: "string",
          required: false,
          defaultValue: "student",
          input: true,
        },
        username: {
          type: "string",
          required: false,
          input: true,
        },
        referralCode: {
          type: "string",
          required: false,
          input: true,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (!isSupabaseProvisioningEnabled(env)) return;
            await reconcileSupabaseApplicationIdentity(env, user);
          },
        },
        update: {
          before: async (data) => {
            // Registration attributes are immutable after first provisioning.
            // Profile edits must use the application profile flow, not Better Auth
            // user-update endpoints, to avoid desynchronizing the identity root.
            const safeData = { ...data } as Record<string, unknown>;
            delete safeData.accountType;
            delete safeData.username;
            delete safeData.referralCode;
            return { data: safeData };
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            if (!isSupabaseProvisioningEnabled(env)) return { data: session };

            // A previous after-hook may have failed after the D1 user row was
            // committed. Retry the idempotent Postgres projection here and
            // withhold this session until the identity exists.
            const user = await ctx.context.adapter.findOne({
              model: "user",
              where: [{ field: "id", value: session.userId }],
            });
            if (!user) {
              throw new APIError("INTERNAL_SERVER_ERROR", {
                message: "APPLICATION_IDENTITY_NOT_READY",
              });
            }

            try {
              await reconcileSupabaseApplicationIdentity(env, user);
            } catch {
              throw new APIError("INTERNAL_SERVER_ERROR", {
                message: "APPLICATION_IDENTITY_NOT_READY",
              });
            }
            return { data: session };
          },
        },
      },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 12,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 5 },
        "/request-password-reset": { window: 3600, max: 3 },
        "/reset-password": { window: 60, max: 10 },
        "/send-verification-email": { window: 3600, max: 3 },
        "/sign-in/social": { window: 60, max: 10 },
        "/oauth2/token": { window: 60, max: 20 },
      },
    },
    advanced: {
      useSecureCookies: true,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      },
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
      database: {
        generateId: "uuid",
      },
    },
    disabledPaths: ["/token"],
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          keyPairConfig: {
            alg: "ES256",
          },
        },
      }),
      oauthProvider({
        loginPage: new URL("/login", appOrigin).toString(),
        consentPage: new URL("/oauth/consent", appOrigin).toString(),
        scopes: ["openid", "profile", "email"],
        resources: [{
          identifier: resourceAudience,
          allowedScopes: ["openid", "profile", "email"],
          accessTokenTtl: 5 * 60,
        }],
        accessTokenExpiresIn: 5 * 60,
        customAccessTokenClaims: () => ({
          role: "authenticated",
        }),
        advertisedMetadata: {
          claims_supported: ["role"],
        },
      }),
    ],
  });
}
