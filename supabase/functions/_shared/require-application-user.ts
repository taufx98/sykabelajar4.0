import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.95.0";
import { resolveApplicationIdentityMode } from "./resolve-application-identity-mode.mjs";

type CallerSupabaseClient = SupabaseClient;

const COMPACT_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

type ApplicationIdentitySuccess = {
  ok: true;
  userId: string;
  userEmail: string | null;
  mode: "supabase" | "better-auth";
  supabase: CallerSupabaseClient;
};

type ApplicationIdentityFailure = {
  ok: false;
  status: number;
  error: string;
};

export type ApplicationIdentityResult =
  | ApplicationIdentitySuccess
  | ApplicationIdentityFailure;

/**
 * Resolve the canonical application UUID using exactly one token verifier.
 * Production and other projects default to Supabase Auth. The exact isolated
 * Free staging Supabase URL selects Better Auth automatically when no explicit
 * AUTH_IDENTITY_MODE is set; an explicit server-side mode always takes priority.
 *
 * Both modes return a caller-scoped Supabase client. This function never
 * creates or returns a service-role client and never accepts a body-supplied
 * owner ID.
 */
export async function requireApplicationUser(
  request: Request,
): Promise<ApplicationIdentityResult> {
  const mode = resolveApplicationIdentityMode({
    configuredMode: Deno.env.get("AUTH_IDENTITY_MODE"),
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
  });
  if (mode !== "supabase" && mode !== "better-auth") {
    return {
      ok: false,
      status: 503,
      error: "AUTH_IDENTITY_MODE_INVALID",
    };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) {
    return { ok: false, status: 401, error: "AUTH_REQUIRED" };
  }

  // Reject malformed compact-JWT envelopes before dynamically importing the
  // staging-only Better Auth verifier. Invalid credentials remain 401, while
  // module/JWKS availability failures remain distinguishable as 503.
  if (mode === "better-auth" && !COMPACT_JWT_PATTERN.test(bearer)) {
    return { ok: false, status: 401, error: "AUTH_REQUIRED" };
  }

  if (mode === "better-auth") {
    // Load the Better Auth verifier only for Better Auth projects. The normal
    // Supabase Auth path should not initialise @supabase/server or its JWKS
    // dependencies; this also keeps the legacy Production adapter isolated
    // from the staging-only Better Auth runtime.
    const { requireBetterAuthUser } = await import("./better-auth-user.ts");
    const identity = await requireBetterAuthUser(request);
    if (!identity.ok) {
      return {
        ok: false,
        status: identity.status ?? 401,
        error: identity.error ?? "AUTH_REQUIRED",
      };
    }

    return {
      ok: true,
      userId: identity.userId,
      userEmail: identity.userEmail ?? null,
      mode,
      supabase: identity.supabase as CallerSupabaseClient,
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim().replace(/\/+$/, "");
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY")?.trim() ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ??
    "";

  if (!supabaseUrl || !publishableKey) {
    return {
      ok: false,
      status: 503,
      error: "AUTH_CONFIGURATION_MISSING",
    };
  }

  const fetchWithAuthTimeout: typeof fetch = (input, init) => {
    const signal = init?.signal ?? AbortSignal.timeout(5000);
    return fetch(input, { ...init, signal });
  };
  const supabase = createClient(supabaseUrl, publishableKey, {
    global: {
      headers: { Authorization: "Bearer " + bearer },
      fetch: fetchWithAuthTimeout,
    },
  });

  let user: { id: string; email?: string | null } | null = null;
  try {
    const result = await supabase.auth.getUser();
    if (result.error || !result.data.user) {
      return { ok: false, status: 401, error: "INVALID_SESSION" };
    }
    user = result.data.user;
  } catch {
    return { ok: false, status: 503, error: "AUTH_VERIFICATION_UNAVAILABLE" };
  }

  return {
    ok: true,
    userId: user.id,
    userEmail: user.email ?? null,
    mode,
    supabase,
  };
}
