import { handleCloudinaryProfileUpload } from "./index.ts";

const ISSUER = "https://auth.sykabelajar.my.id/api/auth";
const JWKS_URL = ISSUER + "/jwks";
const LOCAL_JWKS_URL = "http://127.0.0.1:8787/api/auth/jwks";
const CLOUDINARY_ORIGIN = "https://api.cloudinary.com";
const PUBLISHABLE_KEY = "sb_publishable_test_only";
const SECRET_KEY = "sb_secret_test_only";

Deno.test("migrated Cloudinary profile handler accepts a real D1-issued Better Auth access token", async () => {
  const token = Deno.env.get("STAGE5_BETTER_AUTH_ACCESS_TOKEN");
  const userId = Deno.env.get("STAGE5_BETTER_AUTH_USER_ID");
  if (!token || !userId) {
    throw new Error("STAGE5_D1_HANDLER_ACCEPTANCE_REQUIRES_TOKEN_AND_USER_ID");
  }

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
  let jwksRequests = 0;
  let cloudinaryRequests = 0;
  let uploadedPublicId: string | null = null;
  const foreignUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  try {
    Deno.env.set("AUTH_IDENTITY_MODE", "better-auth");
    Deno.env.set("SUPABASE_URL", "https://ydamszdfsxqisanazdkb.supabase.co");
    Deno.env.set("SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
    Deno.env.set("SUPABASE_SECRET_KEY", SECRET_KEY);
    Deno.env.set("BETTER_AUTH_ISSUER", ISSUER);
    Deno.env.set("BETTER_AUTH_RESOURCE_AUDIENCE", "https://sykabelajar.my.id");
    Deno.env.set("CLOUDINARY_CLOUD_NAME", "stage5-local-mock-cloud");
    Deno.env.set("CLOUDINARY_API_KEY", "stage5-local-mock-api-key");
    Deno.env.set("CLOUDINARY_API_SECRET", "stage5-local-mock-api-secret");

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawUrl = input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
      const url = new URL(rawUrl);

      if (url.href === JWKS_URL) {
        jwksRequests += 1;
        const localRequest = input instanceof Request
          ? new Request(LOCAL_JWKS_URL, input)
          : new Request(LOCAL_JWKS_URL, init);
        return originalFetch(localRequest);
      }

      if (url.origin === CLOUDINARY_ORIGIN && url.pathname === "/v1_1/stage5-local-mock-cloud/image/upload") {
        cloudinaryRequests += 1;
        if (!(init?.body instanceof FormData)) {
          throw new Error("CLOUDINARY_MOCK_EXPECTED_FORM_DATA");
        }
        uploadedPublicId = String(init.body.get("public_id") ?? "");
        return new Response(JSON.stringify({
          public_id: uploadedPublicId,
          secure_url: "https://res.cloudinary.com/stage5-local-mock-cloud/image/upload/mock.png",
          width: 400,
          height: 400,
          version: 1,
          resource_type: "image",
          asset_id: "stage5-local-mock-asset",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.hostname === "ydamszdfsxqisanazdkb.supabase.co") {
        throw new Error("STAGE5_HANDLER_TEST_MUST_NOT_CALL_HOSTED_SUPABASE");
      }
      return originalFetch(input, init);
    };

    const form = new FormData();
    form.append("file", new File([Uint8Array.of(137, 80, 78, 71)], "stage5-d1-issued.png", { type: "image/png" }));
    form.append("kind", "profile");
    form.append("user_id", foreignUserId);
    const request = new Request("https://local.test/functions/v1/cloudinary-profile-upload", {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        authorization: "Bearer " + token,
      },
      body: form,
    });

    const response = await handleCloudinaryProfileUpload(request);
    const body = await response.json();
    if (response.status !== 200) {
      throw new Error("D1-issued token did not reach a successful handler response: " +
        response.status + " " + JSON.stringify(body));
    }

    const expectedPublicId = "profile_pictures/user_" + userId;
    if (jwksRequests < 1) throw new Error("Handler did not resolve the local Worker's real D1 JWKS.");
    if (cloudinaryRequests !== 1) throw new Error("Handler did not make exactly one mocked Cloudinary request.");
    if (uploadedPublicId !== expectedPublicId) {
      throw new Error("Handler did not derive Cloudinary ownership from the verified Better Auth UUID.");
    }
    if (body.public_id !== expectedPublicId || body.user_id !== userId) {
      throw new Error("Handler response does not preserve the verified Better Auth owner UUID.");
    }
    if (body.secure_url !== "https://res.cloudinary.com/stage5-local-mock-cloud/image/upload/mock.png") {
      throw new Error("Handler did not return the mocked Cloudinary response.");
    }

    console.log("Stage 5 passed: actual local D1-issued Better Auth JWT verified by the shared handler adapter; profile asset ownership derived from JWT sub; Cloudinary mocked.");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
