const LOGIN_EVENT_SUPPRESSION_MAX_AGE_MS = 120_000;

/**
 * Do not let a same-tab sign-in/account-switch event reload the login page
 * while AppContext is still completing login and LoginPage is about to route.
 * Cross-tab account changes and normal sign-outs still force a clean reload.
 *
 * @param {{type?:unknown, identityChanged?:unknown, previousUserId?:unknown}} event
 * @param {number} loginStartedAt
 * @param {number} [now]
 */
export function shouldReloadForAuthSessionEvent(event, loginStartedAt, now = Date.now()) {
  const loginAge = now - Number(loginStartedAt);
  const loginInProgress = Number.isFinite(loginAge) &&
    loginAge >= 0 &&
    loginAge <= LOGIN_EVENT_SUPPRESSION_MAX_AGE_MS;
  if (loginInProgress) return false;

  const accountChanged = event?.identityChanged === true && event?.previousUserId !== null;
  return event?.type === "SIGNED_OUT" || accountChanged;
}
