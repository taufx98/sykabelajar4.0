export function isValidBetterAuthSignInUser(user: unknown): user is {
  id: string;
  email: string;
  emailVerified: boolean;
};
export function isD1FreeQuotaError(error: unknown): boolean;
export function getAuthRetryAtUtc(error: unknown): string | null;

export function confirmSessionAfterSignIn<T>(
  readSession: () => Promise<T | null>,
  options?: { retryDelaysMs?: number[] },
): Promise<T>;
