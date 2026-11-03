import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import type { Env } from "./env";

function parseOrigins(value: string): string[] {
  const origins = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const origin of origins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !["https:", "http:"].includes(parsed.protocol)) {
      throw new Error("APP_ORIGINS must contain exact origins only.");
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("Non-local trusted origins must use HTTPS.");
    }
  }

  return origins;
}

export function createAuth(env: Env) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
  }

  const baseUrl = new URL(env.BETTER_AUTH_URL);
  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
    throw new Error("BETTER_AUTH_URL must use HTTPS outside localhost.");
  }

  const supabaseResource = env.SUPABASE_RESOURCE?.trim();
  if (!supabaseResource || new URL(supabaseResource).protocol !== "https:") {
    throw new Error("SUPABASE_RESOURCE must be the HTTPS Supabase project URL.");
  }

  const trustedOrigins = Array.from(new Set([
    baseUrl.origin,
    ...parseOrigins(env.APP_ORIGINS ?? ""),
  ]));

  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
  const oauthClientId = env.OAUTH_CLIENT_ID?.trim();

  return betterAuth({
    appName: "SYKABELAJAR Auth PoC",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins,

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },

    ...(googleConfigured
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID!.trim(),
              clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
            },
          },
        }
      : {}),

    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        allowDifferentEmails: false,
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 6,
      // Cookie cache is intentionally not enabled: a cached session must not outlive revocation.
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 20,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60 * 60, max: 3 },
      },
    },

    advanced: {
      database: {
        generateId: "uuid",
      },
      useSecureCookies: true,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      },
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
      cookiePrefix: "sykabelajar-auth-poc",
    },

    // The legacy JWT /token endpoint is disabled in OAuth Provider mode.
    // OAuth access tokens are issued only through /oauth2/token.
    disabledPaths: ["/token"],

    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          keyPairConfig: {
            alg: "ES256",
          },
          rotationInterval: 60 * 60 * 24 * 30,
          gracePeriod: 60 * 60 * 24 * 30,
        },
      }),
      oauthProvider({
        loginPage: "/__poc/",
        scopes: ["openid", "profile", "email", "offline_access"],
        resources: [
          {
            identifier: supabaseResource,
            accessTokenTtl: 60 * 10,
          },
        ],
        validAudiences: [supabaseResource],
        customAccessTokenClaims: () => ({
          // This is the PostgreSQL role claim, not SYKABELAJAR's business role.
          role: "authenticated",
        }),
        ...(oauthClientId ? { cachedTrustedClients: new Set([oauthClientId]) } : {}),
      }),
    ],
  });
}

export function getAuthPublicConfig(env: Env) {
  const issuer = new URL("/api/auth", env.BETTER_AUTH_URL).toString().replace(/\/$/, "");
  return {
    issuer,
    discoveryUrl: issuer + "/.well-known/openid-configuration",
    jwksUrl: issuer + "/jwks",
    supabaseResource: env.SUPABASE_RESOURCE,
    googleConfigured: Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()),
    oauthClientConfigured: Boolean(env.OAUTH_CLIENT_ID?.trim()),
    supabaseClientConfigured: Boolean(env.SUPABASE_PUBLISHABLE_KEY?.trim()),
    pocEnabled: env.POC_ENABLED === "true",
  };
}
