/**
 * Provider-neutral application identity lookup.
 *
 * The live Supabase Auth provider publishes its UUID through the shared
 * auth-session event bus. Better Auth can become the publisher during the
 * coordinated Stage 4 session cutover without changing callers.
 */

/**
 * @param {{
 *   getSnapshot: () => ({initialized?: boolean, userId?: string | null} | null),
 *   getFallbackUserId: () => Promise<string | null | undefined>
 * }} dependencies
 */
export function createApplicationIdentityReader(dependencies) {
  if (typeof dependencies?.getSnapshot !== "function" ||
      typeof dependencies?.getFallbackUserId !== "function") {
    throw new TypeError("APPLICATION_IDENTITY_READER_DEPENDENCIES_REQUIRED");
  }

  const normalizeUserId = (value) =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  return async function getCurrentApplicationUserId() {
    const snapshot = dependencies.getSnapshot();
    if (snapshot?.initialized === true) {
      // An initialized signed-out snapshot is authoritative; never resurrect
      // a stale session from the provider's local storage.
      return normalizeUserId(snapshot.userId);
    }

    // App startup can render a consumer before AppContext has published its
    // initial state. Fall back to the configured provider only during this
    // short bootstrap window.
    return normalizeUserId(await dependencies.getFallbackUserId());
  };
}
