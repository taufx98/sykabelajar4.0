import { getPlatformProxy } from "wrangler";
import { createAuth } from "./auth";
import type { AuthWorkerEnv } from "./env";

// The Better Auth CLI runs in Node, so obtain a disposable, local-only D1
// binding from Wrangler. persist:false prevents any schema-generation state
// from being stored in a shared or production database.
const platform = await getPlatformProxy<AuthWorkerEnv>({
  configPath: "./wrangler.toml",
  persist: false,
  remoteBindings: false,
});

const authEnv: AuthWorkerEnv = {
  ...(platform.env as AuthWorkerEnv),
  BETTER_AUTH_SECRET:
    (platform.env as Partial<AuthWorkerEnv>).BETTER_AUTH_SECRET ??
    "local-schema-generation-only-secret-do-not-deploy",
};

export const auth = createAuth(authEnv);
export default auth;
