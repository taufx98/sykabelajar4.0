import { requireApplicationUser } from "./require-application-user.ts";
import { STAGING_BETTER_AUTH_SUPABASE_URL } from "./resolve-application-identity-mode.mjs";

const ISSUER = "https://auth.sykabelajar.my.id/api/auth";
const AUDIENCE = "https://sykabelajar.my.id";
const PUBLISHABLE_KEY = "sb_publishable_test_only";
const SECRET_KEY = "sb_secret_test_only";
const USER_ID = "4e65dbd7-7e1c-4d8a-8a7f-0c7d4fbf7a11";
const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function encodeJson(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

async function signToken(
  privateKey: CryptoKey,
  kid: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = encodeJson({ alg: "ES256", typ: "JWT", kid });
  const payload = encodeJson(claims);
  const signingInput = header + "." + payload;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(signingInput),
  ));
  return signingInput + "." + base64Url(signature);
}

function requestFor(token: string): Request {
  return new Request("https://staging.sykabelajar.my.id/api/auth-acceptance", {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: "{}",
  });
}

async function expectUnauthorized(token: string, label: string): Promise<void> {
  const result = await requireApplicationUser(requestFor(token));
  if (result.ok) throw new Error(label + " unexpectedly authenticated");
  if (result.status !== 401) {
    throw new Error(label + " returned " + result.status + " (" + result.error + "), expected 401");
  }
}

Deno.test("shared Better Auth resolver verifies ES256/JWKS and rejects invalid tokens", async () => {
  const envNames = [
    "AUTH_IDENTITY_MODE",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "BETTER_AUTH_ISSUER",
    "BETTER_AUTH_RESOURCE_AUDIENCE",
  ];
  const previousEnv = new Map(envNames.map((name) => [name, Deno.env.get(name)]));
  const originalFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const kid = "stage5-ephemeral-es256";

  const validKeyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", validKeyPair.publicKey);
  const jwks = {
    keys: [{
      ...publicJwk,
      kid,
      alg: "ES256",
      use: "sig",
    }],
  };

  const validClaims = {
    iss: ISSUER,
    sub: USER_ID,
    aud: AUDIENCE,
    role: "authenticated",
    iat: now - 10,
    exp: now + 290,
    email: "stage5-es256@example.test",
  };

  try {
    Deno.env.set("AUTH_IDENTITY_MODE", "better-auth");
    Deno.env.set("SUPABASE_URL", STAGING_BETTER_AUTH_SUPABASE_URL);
    Deno.env.set("SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
    Deno.env.set("SUPABASE_SECRET_KEY", SECRET_KEY);
    Deno.env.set("BETTER_AUTH_ISSUER", ISSUER);
    Deno.env.set("BETTER_AUTH_RESOURCE_AUDIENCE", AUDIENCE);

    let jwksRequests = 0;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
      if (url === ISSUER + "/jwks") {
        jwksRequests += 1;
        return new Response(JSON.stringify(jwks), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
        });
      }
      throw new Error("Unexpected network request from isolated ES256 verifier test: " + new URL(url).origin);
    };

    const validToken = await signToken(validKeyPair.privateKey, kid, validClaims);
    const accepted = await requireApplicationUser(requestFor(validToken));
    if (!accepted.ok) {
      throw new Error("Valid ES256 token was rejected: " + accepted.status + " " + accepted.error);
    }
    if (accepted.mode !== "better-auth" || accepted.userId !== USER_ID) {
      throw new Error("Verified caller UUID or identity mode did not match the signed token.");
    }
    if (!accepted.supabase) throw new Error("Verifier did not return the caller-scoped Supabase client.");
    if (jwksRequests < 1) throw new Error("Verifier did not fetch the pinned Better Auth JWKS.");

    const malformed = "not-a-real-jwt";
    await expectUnauthorized(malformed, "malformed compact token");

    const wrongIssuer = await signToken(validKeyPair.privateKey, kid, {
      ...validClaims,
      iss: "https://attacker.example/api/auth",
    });
    await expectUnauthorized(wrongIssuer, "wrong issuer");

    const wrongAudience = await signToken(validKeyPair.privateKey, kid, {
      ...validClaims,
      aud: "https://attacker.example",
    });
    await expectUnauthorized(wrongAudience, "wrong audience");

    const expired = await signToken(validKeyPair.privateKey, kid, {
      ...validClaims,
      iat: now - 310,
      exp: now - 10,
    });
    await expectUnauthorized(expired, "expired token");

    const wrongBusinessRole = await signToken(validKeyPair.privateKey, kid, {
      ...validClaims,
      role: "admin",
    });
    await expectUnauthorized(wrongBusinessRole, "business role in Postgres JWT role claim");

    const invalidSubject = await signToken(validKeyPair.privateKey, kid, {
      ...validClaims,
      sub: "not-a-uuid",
    });
    await expectUnauthorized(invalidSubject, "non-UUID subject");

    const wrongKeyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const wrongSignature = await signToken(wrongKeyPair.privateKey, kid, validClaims);
    await expectUnauthorized(wrongSignature, "modified/unknown signing key");

    console.log("Stage 5 shared Better Auth verifier accepted one ephemeral ES256/JWKS token and rejected six invalid token cases.");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
