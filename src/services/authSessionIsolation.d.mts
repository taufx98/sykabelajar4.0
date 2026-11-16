export interface AuthSessionIsolationEvent {
  type?: string;
  identityChanged?: boolean;
  previousUserId?: string | null;
}

export function shouldReloadForAuthSessionEvent(
  event: AuthSessionIsolationEvent,
  loginStartedAt: number,
  now?: number,
): boolean;
