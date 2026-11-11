export function confirmSessionAfterSignIn<T>(
  readSession: () => Promise<T | null>,
  options?: { retryDelaysMs?: number[] },
): Promise<T>;
