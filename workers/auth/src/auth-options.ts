export interface AuthWorkerEnv {
  DB: D1Database;
  AUTH_SECRET: string;
  AUTH_BASE_URL: string;
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SUPABASE_JWT_AUDIENCE: string;
}

export function createAuthOptions(env: AuthWorkerEnv) {
  return {
    appName: "SYKABELAJAR",
    baseURL: env.AUTH_BASE_URL,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.APP_ORIGIN],
    disabledPaths: ["/token"],
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        requireEmailVerification: true,
      },
    },
    // Password sign-up remains disabled in this isolated POC until an email
    // delivery provider and verification/reset delivery have been selected.
    emailAndPassword: {
      enabled: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/social": { window: 60, max: 8 },
        "/callback/google": { window: 60, max: 8 },
        "/oauth2/token": { window: 60, max: 20 },
      },
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
      useSecureCookies: true,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      },
    },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: {
          keyPairConfig: { alg: "ES256" },
          rotationInterval: 60 * 60 * 24 * 30,
          // Keep the old public key available while Supabase refreshes JWKS.
          gracePeriod: 60 * 60 * 24 * 30,
        },
      }),
      oauthProvider({
        allowDynamicClientRegistration: false,
        resources: [
          {
            identifier: env.SUPABASE_JWT_AUDIENCE,
            accessTokenTtl: 300,
          },
        ],
        customAccessTokenClaims: () => ({
          role: "authenticated",
        }),
      }),
    ],
  };
}

// Keep Better Auth options independent from Worker-specific database binding.
// The Worker injects its per-request D1 Drizzle adapter into this configuration.
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
