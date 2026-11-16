export interface AuthSessionEvent {
  type: string;
  userId: string | null;
  previousUserId: string | null;
  identityChanged: boolean;
  initialized: true;
}

export function publishAuthSessionEvent(
  type: string,
  userId: string | null | undefined,
): AuthSessionEvent;

export function subscribeAuthSessionEvents(
  listener: (event: AuthSessionEvent) => void,
): () => void;

export function getAuthSessionSnapshot(): AuthSessionEvent | null;
