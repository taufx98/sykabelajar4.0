import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import { createAuthOptions, type AuthWorkerEnv } from "./auth-options";

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function corsHeaders(origin: string): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-CSRF-Token, X-Requested-With",
  );
  headers.set("Access-Control-Max-Age", "600");
  headers.set("Vary", "Origin");
  return headers;
}

function withCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(origin)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function validConfiguration(env: AuthWorkerEnv): boolean {
  return Boolean(
    env.DB &&
    env.AUTH_SECRET &&
    env.AUTH_SECRET.length >= 32 &&
    env.AUTH_BASE_URL &&
    env.APP_ORIGIN &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.SUPABASE_JWT_AUDIENCE,
  );
}

export default {
  async fetch(request: Request, env: AuthWorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" && request.method === "GET") {
      return json({ service: "sykabelajar-auth-poc", status: "ok" });
    }

    if (url.pathname !== "/api/auth" && !url.pathname.startsWith("/api/auth/")) {
      return json({ error: "NOT_FOUND" }, 404);
    }

    const origin = request.headers.get("Origin");
    if (origin && origin !== env.APP_ORIGIN) {
      return json({ error: "ORIGIN_NOT_ALLOWED" }, 403, { Vary: "Origin" });
    }

    if (request.method === "OPTIONS") {
      if (!origin || origin !== env.APP_ORIGIN) {
        return json({ error: "ORIGIN_NOT_ALLOWED" }, 403, { Vary: "Origin" });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!validConfiguration(env)) {
      return json({ error: "AUTH_SERVICE_NOT_CONFIGURED" }, 503);
    }

    const database = drizzle(env.DB);
    const auth = betterAuth({
      ...createAuthOptions(env),
      database: drizzleAdapter(database, { provider: "sqlite" }),
    });

    const response = await auth.handler(request);
    return origin === env.APP_ORIGIN ? withCors(response, origin) : response;
  },
};
