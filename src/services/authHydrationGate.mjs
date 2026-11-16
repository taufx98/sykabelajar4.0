/**
 * Prevents an older asynchronous profile/role lookup from overwriting a newer
 * authentication session after a sign-out or account switch.
 */
export function createAuthHydrationGate() {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      return generation;
    },
    invalidate() {
      generation += 1;
      return generation;
    },
    isCurrent(request) {
      return Number.isSafeInteger(request) && request === generation;
    },
  };
}
