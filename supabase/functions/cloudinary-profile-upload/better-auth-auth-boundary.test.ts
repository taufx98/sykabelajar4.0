import { handleCloudinaryProfileUpload } from "./index.ts";

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

function uploadRequest(token: string): Request {
  const form = new FormData();
  form.append("file", new File([Uint8Array.of(1, 2, 3)], "probe.png", { type: "image/png" }));
  form.append("kind", "not-a-valid-upload-kind");
  // The caller-supplied owner identifier must not override the verified JWT sub.
  form.append("user_id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  return new Request("https://local.test/functions/v1/cloudinary-profile-upload", {
    method: "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      authorization: "Bearer " + token,
    },
    body: form,
  });
}

async function expectRejected(token: string, label: string): Promise<void> {
  const response = await handleCloudinaryProfileUpload(uploadRequest(token));
  const body = await response.json();
  if (response.status !== 401 || body.error === undefined) {
    throw new Error(label + " must fail authentication with HTTP 401; received " +
      response.status + " " + JSON.stringify(body));
  }
}

Deno.test("actual migrated Cloudinary profile-upload handler accepts only signed Better Auth identity", async () => {
  const envNames = [
    "AUTH_IDENTITY_MODE",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "BETTER_AUTH_ISSUER",
    "BETTER_AUTH_RESOURCE_AUDIENCE",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];
  const previousEnv = new Map(envNames.map((name) => [name, Deno.env.get(name)]));
  const originalFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const kid = "stage5-handler-ephemeral-es256";

  const validPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", validPair.publicKey);
  const jwks = { keys: [{ ...publicJwk, kid, alg: "ES256", use: "sig" }] };
  const validClaims = {
    iss: ISSUER,
    sub: USER_ID,
    aud: AUDIENCE,
    role: "authenticated",
    iat: now - 10,
    exp: now + 290,
    email: "stage5-handler@example.test",
  };

  try {
    Deno.env.set("AUTH_IDENTITY_MODE", "better-auth");
    // Only the adapter's identity-mode selection is needed. No database query is
    // reached because invalid image kind exits before any Cloudinary request.
    Deno.env.set("SUPABASE_URL", "https://ydamszdfsxqisanazdkb.supabase.co");
    Deno.env.set("SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
    Deno.env.set("SUPABASE_SECRET_KEY", SECRET_KEY);
    Deno.env.set("BETTER_AUTH_ISSUER", ISSUER);
    Deno.env.set("BETTER_AUTH_RESOURCE_AUDIENCE", AUDIENCE);
    Deno.env.set("CLOUDINARY_CLOUD_NAME", "synthetic-test-cloud");
    Deno.env.set("CLOUDINARY_API_KEY", "synthetic-test-key");
    Deno.env.set("CLOUDINARY_API_SECRET", "synthetic-test-secret");

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
      return originalFetch(input, init);
    };

    const validToken = await signToken(validPair.privateKey, kid, validClaims);
    const accepted = await handleCloudinaryProfileUpload(uploadRequest(validToken));
    const acceptedBody = await accepted.json();
    if (accepted.status !== 400 || acceptedBody.error !== "INVALID_IMAGE_KIND") {
      throw new Error("Valid ES256 identity did not reach the handler's post-auth validation boundary: " +
        accepted.status + " " + JSON.stringify(acceptedBody));
    }
    if (jwksRequests < 1) {
      throw new Error("The actual handler did not verify its bearer against the pinned Better Auth JWKS.");
    }

    await expectRejected("not-a-real-jwt", "malformed token");

    const wrongIssuer = await signToken(validPair.privateKey, kid, {
      ...validClaims,
      iss: "https://attacker.example/api/auth",
    });
    await expectRejected(wrongIssuer, "wrong issuer");

    const wrongAudience = await signToken(validPair.privateKey, kid, {
      ...validClaims,
      aud: "https://attacker.example",
    });
    await expectRejected(wrongAudience, "wrong audience");

    const expired = await signToken(validPair.privateKey, kid, {
      ...validClaims,
      iat: now - 310,
      exp: now - 10,
    });
    await expectRejected(expired, "expired token");

    const wrongRole = await signToken(validPair.privateKey, kid, {
      ...validClaims,
      role: "admin",
    });
    await expectRejected(wrongRole, "business role in Postgres JWT role claim");

    const invalidSubject = await signToken(validPair.privateKey, kid, {
      ...validClaims,
      sub: "not-a-uuid",
    });
    await expectRejected(invalidSubject, "non-UUID subject");

    const otherPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const invalidSignature = await signToken(otherPair.privateKey, kid, validClaims);
    await expectRejected(invalidSignature, "signature not matching the configured JWKS key");

    console.log("Stage 5 actual Cloudinary profile-upload handler accepted one verified ES256 identity and rejected six invalid tokens; provider API was not called.");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
