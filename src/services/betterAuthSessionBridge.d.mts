export type BetterAuthSessionEvent =
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY";

export interface BetterAuthSessionSnapshot {
  user: { id: string; email?: string };
  session: { expiresAt: string };
}

export function broadcastBetterAuthSessionEvent(
  type: BetterAuthSessionEvent,
  options?: { windowObject?: Window | null },
): boolean;

export function createBetterAuthSessionBridge(input: {
  getSession: () => Promise<BetterAuthSessionSnapshot | null>;
  onChange: (
    type: string,
    session: BetterAuthSessionSnapshot | null,
  ) => void;
  windowObject?: Window | null;
  documentObject?: Document | null;
}): {
  refresh: () => Promise<void>;
  unsubscribe: () => void;
};
