/**
 * In-memory cache for short-lived Better Auth resource JWTs.
 *
 * Tokens are bound to the active authenticated UUID. Identity changes and
 * explicit clears invalidate both cached values and in-flight exchanges.
 * No browser storage or long-lived refresh token is used.
 */

/**
 * @param {{refreshMarginMs?:number, now?:()=>number}} [options]
 */
export function createAuthResourceTokenCache(options = {}) {
  const refreshMarginMs = Number.isFinite(options.refreshMarginMs)
    ? Math.max(0, Number(options.refreshMarginMs))
    : 45_000;
  const now = typeof options.now === "function" ? options.now : () => Date.now();

  /** @type {string | null | undefined} */
  let activeUserId;
  let generation = 0;
  /** @type {{userId:string, token:string, expiresAt:number} | null} */
  let cached = null;
  /** @type {{userId:string, generation:number, promise:Promise<string>} | null} */
  let inFlight = null;

  function setActiveUserId(value) {
    const nextUserId = typeof value === "string" && value.trim() ? value.trim() : null;
    if (activeUserId === nextUserId) return false;

    activeUserId = nextUserId;
    generation += 1;
    cached = null;
    inFlight = null;
    return true;
  }

  function getCachedToken(userId) {
    if (!userId || activeUserId !== userId || !cached || cached.userId !== userId) {
      return null;
    }
    if (cached.expiresAt <= now() + refreshMarginMs) {
      cached = null;
      return null;
    }
    return cached.token;
  }

  function clear() {
    generation += 1;
    cached = null;
    inFlight = null;
  }

  async function getOrCreate(userId, createToken) {
    if (!userId || activeUserId !== userId) {
      throw new Error("AUTH_RESOURCE_TOKEN_SESSION_CHANGED");
    }

    const existing = getCachedToken(userId);
    if (existing) return existing;

    if (inFlight?.userId === userId && inFlight.generation === generation) {
      return inFlight.promise;
    }

    const requestGeneration = generation;
    const promise = Promise.resolve()
      .then(() => createToken())
      .then((result) => {
        if (requestGeneration !== generation || activeUserId !== userId) {
          throw new Error("AUTH_RESOURCE_TOKEN_SESSION_CHANGED");
        }
        if (
          !result ||
          typeof result.token !== "string" ||
          !result.token ||
          !Number.isFinite(result.expiresAt) ||
          result.expiresAt <= now() + refreshMarginMs
        ) {
          throw new Error("AUTH_RESOURCE_TOKEN_RESULT_INVALID");
        }

        cached = {
          userId,
          token: result.token,
          expiresAt: result.expiresAt,
        };
        return result.token;
      });

    inFlight = { userId, generation: requestGeneration, promise };
    try {
      return await promise;
    } finally {
      if (inFlight?.promise === promise) inFlight = null;
    }
  }

  return {
    setActiveUserId,
    getCachedToken,
    getOrCreate,
    clear,
    getActiveUserId: () => activeUserId,
  };
}
