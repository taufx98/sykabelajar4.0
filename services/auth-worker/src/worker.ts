import { createAuth } from "./auth";
import type { AuthWorkerEnv } from "./env";
import { applyResponseHeaders, createCorsHeaders } from "./security.mjs";

const authInstances = new WeakMap<object, ReturnType<typeof createAuth>>();

function getAuth(env: AuthWorkerEnv) {
  const key = env.DB as object;
  const existing = authInstances.get(key);
  if (existing) return existing;

  const auth = createAuth(env);
  authInstances.set(key, auth);
  return auth;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: AuthWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const allowedOrigins = [env.APP_ORIGIN, ...(env.DEV_APP_ORIGIN ? [env.DEV_APP_ORIGIN] : [])];
    const corsHeaders = createCorsHeaders(request, allowedOrigins);

    if (request.method === "OPTIONS") {
      if (!corsHeaders) return new Response(null, { status: 403 });
      return applyResponseHeaders(new Response(null, { status: 204 }), corsHeaders);
    }

    if (url.pathname === "/healthz" && request.method === "GET") {
      try {
        await env.DB.prepare("select 1 as ok").first();
        return applyResponseHeaders(json({ ok: true, service: "sykabelajar-auth-poc" }), corsHeaders);
      } catch {
        return applyResponseHeaders(json({ ok: false, service: "sykabelajar-auth-poc" }, 503), corsHeaders);
      }
    }

    if (!url.pathname.startsWith("/api/auth/") && url.pathname !== "/api/auth") {
      return applyResponseHeaders(json({ error: "NOT_FOUND" }, 404), corsHeaders);
    }

    try {
      const response = await getAuth(env).handler(request);
      return applyResponseHeaders(response, corsHeaders);
    } catch {
      return applyResponseHeaders(json({ error: "AUTH_SERVICE_UNAVAILABLE" }, 503), corsHeaders);
    }
  },
} satisfies ExportedHandler<AuthWorkerEnv>;
