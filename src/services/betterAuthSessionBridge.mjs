const CHANNEL_NAME = "sykabelajar-better-auth-session";
const STORAGE_KEY = "sykabelajar_better_auth_session_event_v1";
const SOURCE = "sykabelajar-better-auth-session";
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
  return { source: SOURCE, type: value.type };
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

  const message = Object.freeze({ source: SOURCE, type });
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

  const deliver = (type, session) => {
    if (closed) return;
    try {
      input.onChange(type, session);
    } catch {
      // A consumer error must not prevent future auth/session reconciliation.
    }
  };

  const refresh = async (hint) => {
    const version = ++requestVersion;
    let session;
    try {
      session = await input.getSession();
    } catch {
      // Network/Worker errors are not evidence of a signed-out session.
      return;
    }
    if (closed || version !== requestVersion) return;

    const nextUserId = typeof session?.user?.id === "string"
      ? session.user.id
      : null;
    if (!initialized) {
      initialized = true;
      currentUserId = nextUserId;
      if (hint) deliver(hint, session);
      return;
    }

    const previousUserId = currentUserId;
    currentUserId = nextUserId;
    if (hint) {
      deliver(hint, session);
      return;
    }
    if (previousUserId === nextUserId) return;
    deliver(nextUserId ? "SIGNED_IN" : "SIGNED_OUT", session);
  };

  const receive = (raw) => {
    const message = parseMessage(raw);
    if (message) void refresh(message.type);
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

  return {
    refresh: () => refresh(null),
    unsubscribe() {
      if (closed) return;
      closed = true;
      requestVersion += 1;
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
