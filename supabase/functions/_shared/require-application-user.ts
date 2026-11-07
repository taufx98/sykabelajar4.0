import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.57.4";
import { requireBetterAuthUser } from "./better-auth-user.ts";

type CallerSupabaseClient = SupabaseClient;

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
 * Resolve the canonical application UUID using exactly one configured token
 * verifier. The compatibility default remains Supabase Auth; Better Auth is
 * enabled only by the server-side AUTH_IDENTITY_MODE="better-auth" variable.
 *
 * Both modes return a caller-scoped Supabase client. This function never
 * creates or returns a service-role client and never accepts a body-supplied
 * owner ID.
 */
export async function requireApplicationUser(
  request: Request,
): Promise<ApplicationIdentityResult> {
  const mode = Deno.env.get("AUTH_IDENTITY_MODE")?.trim() || "supabase";
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

  if (mode === "better-auth") {
    const identity = await requireBetterAuthUser(request);
    if (!identity.ok) {
      return {
        ok: false,
        status: identity.status,
        error: identity.error,
      };
    }

    return {
      ok: true,
      userId: identity.userId,
      userEmail: identity.userEmail,
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

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: "Bearer " + bearer } },
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
