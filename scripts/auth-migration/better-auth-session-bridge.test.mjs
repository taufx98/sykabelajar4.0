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
