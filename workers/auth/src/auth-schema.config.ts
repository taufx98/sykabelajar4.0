import { betterAuth } from "better-auth";
import { createAuthOptions } from "./auth-options";

// Schema generation loads the same plugins/options as runtime without a live DB.
// These values are placeholders for code generation only; never deploy this config.
const auth = betterAuth(createAuthOptions({
  DB: undefined as never,
  AUTH_SECRET: "schema-generation-only-not-a-secret",
  AUTH_BASE_URL: "https://auth-poc.invalid",
  APP_ORIGIN: "https://app-poc.invalid",
  GOOGLE_CLIENT_ID: "schema-generation-only",
  GOOGLE_CLIENT_SECRET: "schema-generation-only",
  SUPABASE_JWT_AUDIENCE: "https://supabase-poc.invalid",
}));

export { auth };
