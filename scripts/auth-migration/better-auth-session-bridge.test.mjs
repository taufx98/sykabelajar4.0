import assert from "node:assert/strict";
import test from "node:test";
import {
  broadcastBetterAuthSessionEvent,
  createBetterAuthSessionBridge,
} from "../../src/services/betterAuthSessionBridge.mjs";

class EventTargetMock {
  listeners = new Map();
  timers = new Map();
  nextTimerId = 1;

  setTimeout(callback, delay) {
    const id = this.nextTimerId++;
    this.timers.set(id, { callback, delay });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  runTimeout(id) {
    const timer = this.timers.get(id);
    if (!timer) return false;
    this.timers.delete(id);
    timer.callback();
    return true;
  }

  addEventListener(type, listener) {
    const items = this.listeners.get(type) ?? new Set();
    items.add(listener);
    this.listeners.set(type, items);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function makeSession(id, email = "user@example.test") {
  return {
    user: { id, email },
    session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
  };
}

test("broadcast sends only event metadata, never identity or credentials", () => {
  const sent = [];
  let closed = 0;
  class Channel {
    postMessage(message) { sent.push(message); }
    close() { closed += 1; }
  }
  const windowObject = {
    BroadcastChannel: Channel,
    localStorage: { setItem() { throw new Error("storage fallback must not run"); }, removeItem() {} },
  };

  assert.equal(broadcastBetterAuthSessionEvent("SIGNED_OUT", { windowObject }), true);
  assert.deepEqual(sent, [{ source: "sykabelajar-better-auth-session", type: "SIGNED_OUT" }]);
  assert.equal(closed, 1);
  assert.throws(() => broadcastBetterAuthSessionEvent("UNKNOWN", { windowObject }));
});

test("session bridge revalidates cross-tab events and detects a new signed-out transition", async () => {
  const windowObject = new EventTargetMock();
  const documentObject = new EventTargetMock();
  documentObject.visibilityState = "visible";
  const received = [];
  let current = makeSession("user-a");
  const bridge = createBetterAuthSessionBridge({
    getSession: async () => current,
    onChange: (type, session) => received.push({ type, userId: session?.user.id ?? null }),
    windowObject,
    documentObject,
  });

  await bridge.refresh();
  assert.deepEqual(received, [], "initial snapshot is owned by AppContext bootstrap");
  current = null;
  windowObject.emit("storage", {
    key: "sykabelajar_better_auth_session_event_v1",
    newValue: JSON.stringify({ source: "sykabelajar-better-auth-session", type: "SIGNED_OUT" }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [{ type: "SIGNED_OUT", userId: null }]);
  bridge.unsubscribe();
  windowObject.emit("focus");
  assert.equal(received.length, 1);
});

test("focus reconciliation ignores unchanged identity and reports a changed account", async () => {
  const windowObject = new EventTargetMock();
  const documentObject = new EventTargetMock();
  documentObject.visibilityState = "visible";
  const received = [];
  let current = makeSession("user-a");
  const bridge = createBetterAuthSessionBridge({
    getSession: async () => current,
    onChange: (type, session) => received.push({ type, userId: session?.user.id ?? null }),
    windowObject,
    documentObject,
  });

  await bridge.refresh();
  windowObject.emit("focus");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 0);
  current = makeSession("user-b");
  windowObject.emit("focus");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [{ type: "SIGNED_IN", userId: "user-b" }]);
  bridge.unsubscribe();
});

test("session expiry is revalidated automatically, renewed sessions are rescheduled, and unsubscribe clears the timer", async () => {
  const windowObject = new EventTargetMock();
  const documentObject = new EventTargetMock();
  documentObject.visibilityState = "visible";
  const received = [];
  let current = makeSession("user-a");
  let sessionReads = 0;
  const bridge = createBetterAuthSessionBridge({
    getSession: async () => {
      sessionReads += 1;
      return current;
    },
    onChange: (type, session) => received.push({ type, userId: session?.user.id ?? null }),
    windowObject,
    documentObject,
  });

  // Mount itself must establish the initial identity and expiry deadline;
  // AppContext remains the only owner of the visible initial hydration event.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sessionReads, 1, "bridge mount must read the active provider session once");
  assert.deepEqual(received, [], "initial session must not duplicate AppContext bootstrap");
  assert.equal(windowObject.timers.size, 1, "an authenticated session must schedule one expiry check");
  const [firstTimerId, firstTimer] = [...windowObject.timers.entries()][0];
  assert.ok(firstTimer.delay >= 60_000, "expiry check must run at or just after the server expiry");

  // The session remains valid and is extended by the server when revalidated.
  current = makeSession("user-a");
  assert.equal(windowObject.runTimeout(firstTimerId), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [], "an unchanged identity must not emit a false auth transition");
  assert.equal(windowObject.timers.size, 1, "a renewed session must receive a fresh expiry timer");

  current = null;
  const [renewedTimerId] = [...windowObject.timers.keys()];
  assert.equal(windowObject.runTimeout(renewedTimerId), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [{ type: "SIGNED_OUT", userId: null }]);

  // No pending callback may survive bridge teardown.
  current = makeSession("user-a");
  await bridge.refresh();
  assert.equal(windowObject.timers.size, 1);
  bridge.unsubscribe();
  assert.equal(windowObject.timers.size, 0);
});

test("temporary Worker errors do not cause a false signed-out event", async () => {
  const windowObject = new EventTargetMock();
  const documentObject = new EventTargetMock();
  documentObject.visibilityState = "visible";
  const received = [];
  const bridge = createBetterAuthSessionBridge({
    getSession: async () => { throw new Error("temporary worker outage"); },
    onChange: (type, session) => received.push({ type, session }),
    windowObject,
    documentObject,
  });
  windowObject.emit("focus");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, []);
  bridge.unsubscribe();
});

console.log("Better Auth cross-tab session bridge contract passed.");


test("invalidates cached resource tokens before every session revalidation", async () => {
  const windowObject = new EventTargetMock();
  const documentObject = new EventTargetMock();
  documentObject.visibilityState = "visible";
  const sequence = [];
  const bridge = createBetterAuthSessionBridge({
    onBeforeRefresh: () => sequence.push("invalidate-resource-token-cache"),
    getSession: async () => {
      sequence.push("read-authoritative-session");
      return makeSession("user-a");
    },
    onChange: () => {},
    windowObject,
    documentObject,
  });

  // The mount-time baseline must invalidate stale tokens before asking the
  // Worker for the authoritative session.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sequence.slice(0, 2), [
    "invalidate-resource-token-cache",
    "read-authoritative-session",
  ]);

  // A later explicit revalidation (for example after focus/pageshow) must do
  // the same. This prevents Supabase from reusing a token while session state
  // is being reconciled after a cross-tab/account transition.
  await bridge.refresh();
  assert.deepEqual(sequence.slice(2, 4), [
    "invalidate-resource-token-cache",
    "read-authoritative-session",
  ]);

  bridge.unsubscribe();
});


test("stale cross-tab sign-in/out hints cannot override the authoritative current account", async () => {
  const windowObject = new EventTargetMock();
  const documentObject = new EventTargetMock();
  documentObject.visibilityState = "visible";
  const received = [];
  let current = makeSession("user-a");
  const bridge = createBetterAuthSessionBridge({
    getSession: async () => current,
    onChange: (type, session) => received.push({ type, userId: session?.user.id ?? null }),
    windowObject,
    documentObject,
  });

  await bridge.refresh();
  assert.deepEqual(received, []);

  // A delayed SIGNED_OUT notification from another tab arrives after this
  // tab has already authenticated a different account. Server state wins.
  current = makeSession("user-b");
  windowObject.emit("storage", {
    key: "sykabelajar_better_auth_session_event_v1",
    newValue: JSON.stringify({ source: "sykabelajar-better-auth-session", type: "SIGNED_OUT" }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [{ type: "SIGNED_IN", userId: "user-b" }]);

  // Conversely, a delayed SIGNED_IN notification must not preserve an
  // account after the authoritative session has become null.
  current = null;
  windowObject.emit("storage", {
    key: "sykabelajar_better_auth_session_event_v1",
    newValue: JSON.stringify({ source: "sykabelajar-better-auth-session", type: "SIGNED_IN" }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [
    { type: "SIGNED_IN", userId: "user-b" },
    { type: "SIGNED_OUT", userId: null },
  ]);

  bridge.unsubscribe();
});

test("same-identity sign-in hints are ignored while verified profile events still propagate", async () => {
  const windowObject = new EventTargetMock();
  const documentObject = new EventTargetMock();
  documentObject.visibilityState = "visible";
  const received = [];
  const current = makeSession("user-a");
  const bridge = createBetterAuthSessionBridge({
    getSession: async () => current,
    onChange: (type, session) => received.push({ type, userId: session?.user.id ?? null }),
    windowObject,
    documentObject,
  });

  await bridge.refresh();
  windowObject.emit("storage", {
    key: "sykabelajar_better_auth_session_event_v1",
    newValue: JSON.stringify({ source: "sykabelajar-better-auth-session", type: "SIGNED_IN" }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [], "a stale sign-in hint must not force an unnecessary re-hydration");

  windowObject.emit("storage", {
    key: "sykabelajar_better_auth_session_event_v1",
    newValue: JSON.stringify({ source: "sykabelajar-better-auth-session", type: "USER_UPDATED" }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [{ type: "USER_UPDATED", userId: "user-a" }]);

  bridge.unsubscribe();
});


test("cross-tab hints received during initial session discovery do not emit a false transition", async () => {
  const windowObject = new EventTargetMock();
  const documentObject = new EventTargetMock();
  documentObject.visibilityState = "visible";
  const received = [];
  const pendingReads = [];
  let readCount = 0;
  const bridge = createBetterAuthSessionBridge({
    getSession: () => {
      readCount += 1;
      if (readCount <= 2) {
        return new Promise((resolve) => { pendingReads[readCount - 1] = resolve; });
      }
      return Promise.resolve(null);
    },
    onChange: (type, session) => received.push({ type, userId: session?.user.id ?? null }),
    windowObject,
    documentObject,
  });

  assert.equal(readCount, 1, "bridge mount begins the initial authoritative read");
  windowObject.emit("storage", {
    key: "sykabelajar_better_auth_session_event_v1",
    newValue: JSON.stringify({ source: "sykabelajar-better-auth-session", type: "SIGNED_OUT" }),
  });
  assert.equal(readCount, 2, "cross-tab message triggers an authoritative re-read");

  // The newer read establishes user B as the initial baseline; the older
  // in-flight read is ignored. Neither may dispatch a synthetic transition.
  pendingReads[1](makeSession("user-b"));
  await new Promise((resolve) => setImmediate(resolve));
  pendingReads[0](makeSession("user-a"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, []);

  windowObject.emit("focus");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [{ type: "SIGNED_OUT", userId: null }]);

  bridge.unsubscribe();
});
