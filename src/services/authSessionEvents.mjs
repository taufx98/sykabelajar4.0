/**
 * Single in-app fan-out for authentication identity changes.
 *
 * AppContext is the only owner of the live auth-provider subscription. Cache,
 * account-isolation and service-level invalidation consume this snapshot
 * without creating additional Supabase/Better Auth auth listeners.
 *
 * No access token, refresh token, email or profile data is emitted here.
 */

/** @typedef {{ type: string, userId: string | null, previousUserId: string | null, identityChanged: boolean, initialized: true }} AuthSessionEvent */

/** @type {Set<(event: AuthSessionEvent) => void>} */
const listeners = new Set();
let initialized = false;
/** @type {string | null} */
let currentUserId = null;

/**
 * @param {string} type
 * @param {string | null | undefined} userId
 * @returns {AuthSessionEvent}
 */
export function publishAuthSessionEvent(type, userId) {
  if (typeof type !== 'string' || !type.trim()) {
    throw new TypeError('AUTH_SESSION_EVENT_TYPE_REQUIRED');
  }

  const nextUserId = typeof userId === 'string' && userId.trim()
    ? userId.trim()
    : null;
  const previousUserId = initialized ? currentUserId : null;
  const identityChanged = initialized && previousUserId !== nextUserId;

  currentUserId = nextUserId;
  initialized = true;

  const event = Object.freeze({
    type,
    userId: nextUserId,
    previousUserId,
    identityChanged,
    initialized: true,
  });

  // One observer must not prevent the other session consumers from receiving
  // the event or throw back into the auth-provider callback.
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // Session fan-out is best-effort; each consumer owns its own recovery.
    }
  }

  return event;
}

/**
 * @param {(event: AuthSessionEvent) => void} listener
 * @returns {() => void}
 */
export function subscribeAuthSessionEvents(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('AUTH_SESSION_LISTENER_REQUIRED');
  }

  listeners.add(listener);

  // Replay the last known identity so consumers that mount after AppContext
  // do not need a second provider subscription or an async bootstrap request.
  if (initialized) {
    try {
      listener(Object.freeze({
        type: 'INITIAL_SESSION',
        userId: currentUserId,
        previousUserId: null,
        identityChanged: false,
        initialized: true,
      }));
    } catch {
      // A failing late subscriber must not affect other application code.
    }
  }

  return () => listeners.delete(listener);
}

/** @returns {AuthSessionEvent | null} */
export function getAuthSessionSnapshot() {
  if (!initialized) return null;
  return Object.freeze({
    type: 'INITIAL_SESSION',
    userId: currentUserId,
    previousUserId: null,
    identityChanged: false,
    initialized: true,
  });
}
