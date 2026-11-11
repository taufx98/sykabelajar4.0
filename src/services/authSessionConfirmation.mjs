const DEFAULT_RETRY_DELAYS_MS = [120, 300];

/**
 * Confirm the cookie session after Better Auth has already accepted a
 * sign-in/email request. This retries only the safe GET session read; it never
 * replays the credential POST or converts an auth rejection into success.
 *
 * @template T
 * @param {() => Promise<T|null>} readSession
 * @param {{retryDelaysMs?:number[]}} [options]
 * @returns {Promise<T>}
 */
export async function confirmSessionAfterSignIn(readSession, options = {}) {
  if (typeof readSession !== "function") {
    throw new TypeError("AUTH_SESSION_READER_REQUIRED");
  }

  const retryDelays = Array.isArray(options.retryDelaysMs)
    ? options.retryDelaysMs
    : DEFAULT_RETRY_DELAYS_MS;
  let lastTransientError = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const session = await readSession();
      if (session) return session;
    } catch (error) {
      const status = error && typeof error === "object"
        ? Number(error.status ?? error.statusCode ?? 0)
        : 0;
      const code = error && typeof error === "object" && typeof error.code === "string"
        ? error.code
        : "";
      const transient = status === 429 || status >= 500 ||
        [
          "AUTH_WORKER_UNAVAILABLE",
          "AUTH_WORKER_BAD_RESPONSE",
          "AUTH_SERVICE_UNAVAILABLE",
          "AUTH_REQUEST_FAILED",
        ].includes(code) ||
        (error instanceof TypeError && /fetch|network|load failed/i.test(error.message));

      if (!transient) throw error;
      lastTransientError = error;
    }

    if (attempt < retryDelays.length) {
      const delay = Number(retryDelays[attempt]);
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delay) ? Math.max(0, delay) : 0));
    }
  }

  const failure = new Error("AUTH_SESSION_CONFIRMATION_FAILED");
  if (lastTransientError) failure.cause = lastTransientError;
  throw failure;
}
