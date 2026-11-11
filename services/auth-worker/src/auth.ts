import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import type { AuthWorkerEnv } from "./env";
import { sendAuthEmail } from "./email";
import { APIError } from "better-auth/api";
import type { FacebookProfile, TwitterProfile } from "better-auth/social-providers";
import type { SocialProviderRuntimeConfig } from "./social-provider-settings";
import {
  completeSupabaseEmailVerification,
  ensureSupabaseApplicationIdentity,
  isSupabaseProvisioningEnabled,
  normalizeBetterAuthRegistration,
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

export function createAuth(env: AuthWorkerEnv, managedSocialConfig?: SocialProviderRuntimeConfig, emailVerificationRequired = true) {
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

  // D1-managed credentials become authoritative once Admin saves the first
  // provider. Before that activation, existing server-side Worker secret pairs
  // remain the only supported fallback.
  const managed = managedSocialConfig?.managedMode === true;
  const google = managed ? managedSocialConfig?.providers.google : undefined;
  const facebook = managed ? managedSocialConfig?.providers.facebook : undefined;
  const twitter = managed ? managedSocialConfig?.providers.twitter : undefined;
  const googleClientId = managed ? google?.clientId : env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = managed ? google?.clientSecret : env.GOOGLE_CLIENT_SECRET?.trim();
  const facebookClientId = managed ? facebook?.clientId : env.FACEBOOK_CLIENT_ID?.trim();
  const facebookClientSecret = managed ? facebook?.clientSecret : env.FACEBOOK_CLIENT_SECRET?.trim();
  const twitterClientId = managed ? twitter?.clientId : env.TWITTER_CLIENT_ID?.trim();
  const twitterClientSecret = managed ? twitter?.clientSecret : env.TWITTER_CLIENT_SECRET?.trim();

  for (const [provider, clientId, clientSecret] of [
    ["GOOGLE", googleClientId, googleClientSecret],
    ["FACEBOOK", facebookClientId, facebookClientSecret],
    ["TWITTER", twitterClientId, twitterClientSecret],
  ] as const) {
    if (Boolean(clientId) !== Boolean(clientSecret)) {
      throw new Error(provider + "_OAUTH_REQUIRES_BOTH_CLIENT_ID_AND_CLIENT_SECRET");
    }
  }

  // Providers are enabled only when the owner has installed both credentials.
  // Never ship social client secrets in Pages/frontend variables.
  const configuredSocialProviders = {
    ...(googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            requireEmailVerification: emailVerificationRequired,
          },
        }
      : {}),
    ...(facebookClientId && facebookClientSecret
      ? {
          facebook: {
            clientId: facebookClientId,
            clientSecret: facebookClientSecret,
            scope: ["email", "public_profile"],
            // Facebook's profile can omit email; do not accept an unusable or
            // placeholder address. Local SYKABELAJAR email verification follows.
            mapProfileToUser: (profile: FacebookProfile) => {
              if (!("email" in profile) || typeof profile.email !== "string" || !profile.email.trim()) {
                throw new APIError("BAD_REQUEST", { message: "FACEBOOK_EMAIL_REQUIRED" });
              }
              return {};
            },
            // Facebook has no reliable per-email verification claim. The
            // unconditional session hook below requires SYKABELAJAR verification.
          },
        }
      : {}),
    ...(twitterClientId && twitterClientSecret
      ? {
          twitter: {
            clientId: twitterClientId,
            clientSecret: twitterClientSecret,
            // Better Auth 1.7.16 requests users.email by default and maps only
            // X's confirmed_email response to emailVerified=true. Never let the
            // built-in .invalid placeholder bypass the account email challenge.
            mapProfileToUser: (profile: TwitterProfile) => {
              if (typeof profile.data.email !== "string" || !profile.data.email.trim()) {
                throw new APIError("BAD_REQUEST", { message: "TWITTER_CONFIRMED_EMAIL_REQUIRED" });
              }
              return {};
            },
            requireEmailVerification: emailVerificationRequired,
          },
        }
      : {}),
  };
  const socialProviders = Object.keys(configuredSocialProviders).length > 0
    ? configuredSocialProviders
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
      requireEmailVerification: emailVerificationRequired,
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
      sendOnSignUp: emailVerificationRequired,
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
          returned: false,
        },
        // These fields are a short-lived signup payload for the trusted
        // Postgres profile projection, not user/session claims. They are never
        // returned by Better Auth session APIs.
        birthDate: {
          type: "string",
          required: false,
          input: true,
          returned: false,
        },
        institution: {
          type: "string",
          required: false,
          input: true,
          returned: false,
        },
        grade: {
          type: "string",
          required: false,
          input: true,
          returned: false,
        },
        subjects: {
          type: "string",
          required: false,
          input: true,
          returned: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Validate user-controlled registration fields before the D1 user row
          // is committed. This prevents invalid values from leaving an account
          // that can never be projected into the application identity root.
          before: async (user) => {
            try {
              const registration = normalizeBetterAuthRegistration(user as Record<string, unknown>);
              return { data: { ...user, ...registration } };
            } catch (error) {
              const message = error instanceof Error
                ? error.message
                : "BETTER_AUTH_REGISTRATION_INVALID";
              throw new APIError("BAD_REQUEST", { message });
            }
          },
          after: async (user) => {
            if (!isSupabaseProvisioningEnabled(env)) return;
            await reconcileSupabaseApplicationIdentity(env, user as Record<string, unknown>);
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
            delete safeData.birthDate;
            delete safeData.institution;
            delete safeData.grade;
            delete safeData.subjects;
            return { data: safeData };
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            if (!ctx?.context?.adapter) {
              throw new APIError("INTERNAL_SERVER_ERROR", {
                message: "AUTH_USER_LOOKUP_UNAVAILABLE",
              });
            }

            const user = await ctx.context.adapter.findOne({
              model: "user",
              where: [{ field: "id", value: session.userId }],
            }) as { emailVerified?: boolean } | null;
            if (!user) {
              throw new APIError("INTERNAL_SERVER_ERROR", {
                message: "AUTH_USER_NOT_FOUND",
              });
            }

            // Enforce the same SYKABELAJAR-owned email challenge for password,
            // Google, Facebook and X sign-in. Facebook has no trustworthy
            // provider email_verified claim, and social signup alone must
            // never create an authenticated session before local verification.
            if (emailVerificationRequired && user.emailVerified !== true) {
              throw new APIError("FORBIDDEN", {
                message: "EMAIL_VERIFICATION_REQUIRED",
              });
            }

            if (!isSupabaseProvisioningEnabled(env)) return { data: session };

            // A previous after-hook may have failed after the D1 user row was
            // committed. Reconcile only when no successful D1 projection marker
            // exists or the user's email-verification state has changed. Once
            // projected, login no longer depends on a Supabase provisioning
            // round-trip; app roles are still read independently from Supabase.
            try {
              await ensureSupabaseApplicationIdentity(env, user as Record<string, unknown>);
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
