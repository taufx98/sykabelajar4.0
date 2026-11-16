export interface AuthResourceTokenCache {
  setActiveUserId(userId: string | null | undefined): boolean;
  getCachedToken(userId: string): string | null;
  getOrCreate(
    userId: string,
    createToken: () => Promise<{ token: string; expiresAt: number }> | { token: string; expiresAt: number },
  ): Promise<string>;
  clear(): void;
  getActiveUserId(): string | null | undefined;
}

export function createAuthResourceTokenCache(options?: {
  refreshMarginMs?: number;
  now?: () => number;
}): AuthResourceTokenCache;
