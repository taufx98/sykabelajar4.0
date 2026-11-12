const CHANNEL_NAME = "sykabelajar-better-auth-session";
const STORAGE_KEY = "sykabelajar_better_auth_session_event_v1";
const SOURCE = "sykabelajar-better-auth-session";
// Distinguish tabs without sending any user identity or credential data.
// BroadcastChannel delivers to other channel objects in this tab too, so the
// receiver must ignore messages that originated from this same page instance.
const TAB_SOURCE_ID = (() => {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall back to a non-sensitive per-page identifier.
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
})();
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;
const EXPIRY_RECHECK_GRACE_MS = 1_000;
const VALID_EVENTS = new Set([
  "SIGNED_IN",
  "SIGNED_OUT",
  "USER_UPDATED",
  "PASSWORD_RECOVERY",
]);

function isValidEvent(value) {
  return typeof value === "string" && VALID_EVENTS.has(value);
}

function parseMessage(value) {
  if (!value || typeof value !== "object") return null;
  if (value.source !== SOURCE || !isValidEvent(value.type)) return null;
  return {
    source: SOURCE,
    type: value.type,
    senderId: typeof value.senderId === "string" ? value.senderId : null,
  };
}

/**
 * Publish a same-origin, identity-free notification to sibling tabs.
 * No UUID, email, access token, refresh token or profile field is sent.
 *
 * @param {"SIGNED_IN"|"SIGNED_OUT"|"USER_UPDATED"|"PASSWORD_RECOVERY"} type
 * @param {{windowObject?:Window|null}} [options]
 */
export function broadcastBetterAuthSessionEvent(type, options = {}) {
  if (!isValidEvent(type)) throw new TypeError("BETTER_AUTH_SESSION_EVENT_INVALID");
  const windowObject = options.windowObject ??
    (typeof window === "undefined" ? null : window);
  if (!windowObject) return false;

  const message = Object.freeze({ source: SOURCE, type, senderId: TAB_SOURCE_ID });
  let delivered = false;
  try {
    if (typeof windowObject.BroadcastChannel === "function") {
      const channel = new windowObject.BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(message);
      channel.close();
      delivered = true;
    }
  } catch {
    // Use the same-origin storage event fallback below.
  }

  if (!delivered) {
    try {
      const value = JSON.stringify({ ...message, nonce: Date.now().toString(36) });
      windowObject.localStorage.setItem(STORAGE_KEY, value);
      windowObject.localStorage.removeItem(STORAGE_KEY);
      delivered = true;
    } catch {
      // Cross-tab synchronization is best-effort; the next focus event rechecks.
    }
  }
  return delivered;
}

/**
 * Subscribe to cross-tab and tab-resume changes without polling.
 * The provider session itself is always revalidated with Better Auth; broadcast
 * messages never carry trusted identity data or decide authentication.
 *
 * @param {{
 *   getSession:()=>Promise<{user:{id:string,email?:string},session:{expiresAt:string}}|null>,
 *   onChange:(type:string,session:{user:{id:string,email?:string},session:{expiresAt:string}}|null)=>void,
 *   onSessionChanged?:()=>void,
 *   windowObject?:Window|null,
 *   documentObject?:Document|null
 * }} input
 */
export function createBetterAuthSessionBridge(input) {
  if (typeof input?.getSession !== "function" || typeof input?.onChange !== "function") {
    throw new TypeError("BETTER_AUTH_SESSION_BRIDGE_INPUT_REQUIRED");
  }
  const windowObject = input.windowObject ??
    (typeof window === "undefined" ? null : window);
  const documentObject = input.documentObject ??
    (typeof document === "undefined" ? null : document);

  let closed = false;
  let initialized = false;
  let currentUserId = null;
  let requestVersion = 0;
  let channel = null;
  let expiryTimer = null;
  const scheduleTimeout = typeof windowObject?.setTimeout === "function"
    ? windowObject.setTimeout.bind(windowObject)
    : setTimeout;
  const cancelTimeout = typeof windowObject?.clearTimeout === "function"
    ? windowObject.clearTimeout.bind(windowObject)
    : clearTimeout;

  const clearExpiryTimer = () => {
    if (expiryTimer === null) return;
    cancelTimeout(expiryTimer);
    expiryTimer = null;
  };

  const deliver = (type, session) => {
    if (closed) return;
    try {
      input.onChange(type, session);
    } catch {
      // A consumer error must not prevent future auth/session reconciliation.
    }
  };

  // Revalidate once when the server-issued Better Auth session expires. Focus,
  // pageshow and visibility events remain the fallback when browsers throttle
  // timers in background tabs. This is a deadline check, not periodic polling.
  const scheduleExpiryCheck = (session) => {
    clearExpiryTimer();
    const expiresAt = Date.parse(session?.session?.expiresAt ?? "");
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;

    const delay = Math.min(
      MAX_TIMEOUT_DELAY_MS,
      Math.max(0, expiresAt - Date.now() + EXPIRY_RECHECK_GRACE_MS),
    );
    expiryTimer = scheduleTimeout(() => {
      expiryTimer = null;
      if (!closed) void refresh(null);
    }, delay);
  };

  const refresh = async (hint) => {
    if (closed) return;
    // A focus/visibility check must not evict a still-valid resource token.
    // The token is invalidated only after the authoritative read proves that
    // the signed-in identity actually changed.
    const version = ++requestVersion;
    let session;
    try {
      session = await input.getSession();
    } catch {
      // Network/Worker errors are not evidence of a signed-out session.
      return;
    }
    if (closed || version !== requestVersion) return;

    scheduleExpiryCheck(session);
    const nextUserId = typeof session?.user?.id === "string"
      ? session.user.id
      : null;
    if (!initialized) {
      // The first read establishes a baseline only. AppContext owns initial
      // session hydration; even a queued cross-tab hint must not masquerade as
      // a transition before this bridge knows the previous identity.
      initialized = true;
      currentUserId = nextUserId;
      return;
    }

    const previousUserId = currentUserId;
    currentUserId = nextUserId;

    // A cross-tab message is only a wake-up hint, never an auth decision.
    // Another tab may have switched accounts (or signed out) before this
    // request reached the Worker. Derive sign-in/out exclusively from the
    // authoritative session returned by Better Auth.
    if (previousUserId !== nextUserId) {
      try {
        input.onSessionChanged?.();
      } catch {
        // Invalidation is best-effort; the authoritative session transition wins.
      }
      deliver(nextUserId ? "SIGNED_IN" : "SIGNED_OUT", session);
      return;
    }

    // Same-identity events may still require profile/password-recovery
    // consumers to refresh, but sign-in/out hints must not create transitions.
    if (session && (hint === "USER_UPDATED" || hint === "PASSWORD_RECOVERY")) {
      deliver(hint, session);
    }
  };

  const receive = (raw) => {
    const message = parseMessage(raw);
    // A page must not react to its own sign-in/out broadcast. Otherwise its
    // own transition can invalidate a resource-token exchange that is already
    // in progress for this same login.
    if (!message || message.senderId === TAB_SOURCE_ID) return;
    void refresh(message.type);
  };

  const onStorage = (event) => {
    if (event?.key !== STORAGE_KEY || !event.newValue) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed same-origin storage messages.
    }
  };
  const onFocus = () => { void refresh(null); };
  const onVisibility = () => {
    if (!documentObject || documentObject.visibilityState === "visible") {
      void refresh(null);
    }
  };

  if (windowObject) {
    windowObject.addEventListener("storage", onStorage);
    windowObject.addEventListener("focus", onFocus);
    windowObject.addEventListener("pageshow", onFocus);
    try {
      if (typeof windowObject.BroadcastChannel === "function") {
        channel = new windowObject.BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (event) => receive(event.data);
      }
    } catch {
      channel = null;
    }
  }
  documentObject?.addEventListener("visibilitychange", onVisibility);

  // Prime the internal identity/expiry baseline on every mount. AppContext owns
  // the visible INITIAL_SESSION callback through its separate bootstrap read.
  void refresh(null);

  return {
    refresh: () => refresh(null),
    unsubscribe() {
      if (closed) return;
      closed = true;
      requestVersion += 1;
      clearExpiryTimer();
      if (windowObject) {
        windowObject.removeEventListener("storage", onStorage);
        windowObject.removeEventListener("focus", onFocus);
        windowObject.removeEventListener("pageshow", onFocus);
      }
      documentObject?.removeEventListener("visibilitychange", onVisibility);
      if (channel) {
        channel.onmessage = null;
        channel.close();
        channel = null;
      }
    },
  };
}
