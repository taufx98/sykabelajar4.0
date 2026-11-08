import assert from "node:assert/strict";
import test from "node:test";
import {
  getAuthSessionSnapshot,
  publishAuthSessionEvent,
  subscribeAuthSessionEvents,
} from "../../src/services/authSessionEvents.mjs";

test("one session event source replays identity, detects account changes, and isolates observers", () => {
  const received = [];
  const unsubscribe = subscribeAuthSessionEvents((event) => received.push(event));

  assert.equal(received.length, 0, "subscribers wait until AppContext publishes the initial provider state");
  const initial = publishAuthSessionEvent("INITIAL_SESSION", "user-a");
  assert.deepEqual(
    {
      type: initial.type,
      userId: initial.userId,
      previousUserId: initial.previousUserId,
      identityChanged: initial.identityChanged,
    },
    {
      type: "INITIAL_SESSION",
      userId: "user-a",
      previousUserId: null,
      identityChanged: false,
    },
  );
  assert.equal(received.length, 1);

  const replayed = [];
  const unsubscribeLate = subscribeAuthSessionEvents((event) => replayed.push(event));
  assert.equal(replayed.length, 1, "late consumers receive the current identity snapshot immediately");
  assert.equal(replayed[0].userId, "user-a");
  assert.equal(replayed[0].identityChanged, false);

  const refreshed = publishAuthSessionEvent("TOKEN_REFRESHED", "user-a");
  assert.equal(refreshed.identityChanged, false, "token refresh does not invalidate user-owned caches");
  assert.equal(refreshed.previousUserId, "user-a");

  const switched = publishAuthSessionEvent("SIGNED_IN", "user-b");
  assert.equal(switched.identityChanged, true);
  assert.equal(switched.previousUserId, "user-a");
  assert.equal(switched.userId, "user-b");

  let healthyObserverCalls = 0;
  const unsubscribeFailing = subscribeAuthSessionEvents(() => {
    throw new Error("consumer failure must not escape the event fan-out");
  });
  const unsubscribeHealthy = subscribeAuthSessionEvents(() => {
    healthyObserverCalls += 1;
  });
  publishAuthSessionEvent("SIGNED_OUT", null);
  assert.equal(healthyObserverCalls, 1);
  assert.equal(received.at(-1).type, "SIGNED_OUT");
  assert.equal(received.at(-1).previousUserId, "user-b");
  assert.equal(received.at(-1).identityChanged, true);
  assert.equal(getAuthSessionSnapshot()?.userId, null);

  unsubscribeFailing();
  unsubscribeHealthy();
  unsubscribeLate();
  const countBeforeUnsubscribe = received.length;
  unsubscribe();
  publishAuthSessionEvent("SIGNED_IN", "user-c");
  assert.equal(received.length, countBeforeUnsubscribe, "unsubscribed consumers receive no further events");
});
